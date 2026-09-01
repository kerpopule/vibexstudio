#!/usr/bin/env node
// Workbench server — VibeX Studio Desktop sidecar.
//
// Implements workbench/API.md v1 exactly: token-gated project import/export,
// an allowlisted exec surface (npm install/build/typecheck/dev + built-in
// static serve), a job table, a long-poll event stream, and a reverse proxy
// so the phone's WebView can preview running dev servers.
//
// Zero npm dependencies. Node >= 18.

import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const VERSION = 1;
const MAX_IMPORT_BODY = 64 * 1024 * 1024; // 64MB snapshot ceiling
const MAX_FILE_RETURN = 2 * 1024 * 1024;  // files over 2MB are skipped on export
const LOG_TAIL_BYTES = 4096;
const DEV_PORT_BASE = 8850;
const EVENT_HOLD_MS = 25000;
const EVENT_HISTORY = 500;

// ---------------------------------------------------------------- config

const DEFAULT_CONFIG = path.join(
  os.homedir(), 'Library', 'Application Support', 'studio.vibex.desktop', 'workbench.json',
);
const configPath = process.env.WORKBENCH_CONFIG || DEFAULT_CONFIG;

let config;
try {
  config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
} catch (e) {
  console.error(`workbench: cannot read config at ${configPath}: ${e.message}`);
  console.error('workbench: run sidecar/setup-workbench.sh first.');
  process.exit(1);
}
if (!config.token || typeof config.token !== 'string' || config.token.length < 16) {
  console.error('workbench: refusing to start — no usable token in config.');
  process.exit(1);
}
if (config.enabled === false) {
  console.error('workbench: disabled in config (enabled: false). Exiting.');
  process.exit(0);
}
const PORT = Number(config.port) || 8794;

// Spawned by the desktop shell: if the shell dies without a clean quit
// (crash, force-quit) our parent changes — stop instead of squatting on
// the port and its dev servers until reboot.
const PARENT_PID = Number(process.env.WORKBENCH_PARENT_PID) || 0;
if (PARENT_PID && process.ppid === PARENT_PID) {
  setInterval(() => {
    if (process.ppid !== PARENT_PID) {
      console.error('workbench: parent shell went away — shutting down');
      process.kill(process.pid, 'SIGTERM');
    }
  }, 2000).unref();
}
const projectsRoot = config.projectsRoot
  || path.join(os.homedir(), 'VibeXStudio-Projects');
await fs.mkdir(projectsRoot, { recursive: true });

const TOKEN_HASH = crypto.createHash('sha256').update(config.token).digest();
function tokenOk(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  const h = crypto.createHash('sha256').update(candidate).digest();
  return crypto.timingSafeEqual(h, TOKEN_HASH); // constant-time, length-safe
}

// ---------------------------------------------------------------- state

const jobs = new Map();          // jobId -> job record
const devByProject = new Map();  // projectId -> { kind:'dev'|'serve', port, jobId, proc?, server? }
let nextDevPort = DEV_PORT_BASE;

let eventSeq = 0;
const events = [];               // ring of recent events
const eventWaiters = new Set();  // long-poll resolvers

function emit(type, fields) {
  const ev = { seq: ++eventSeq, at: new Date().toISOString(), type, ...fields };
  events.push(ev);
  if (events.length > EVENT_HISTORY) events.splice(0, events.length - EVENT_HISTORY);
  for (const w of [...eventWaiters]) w();
}

function newJob(project, task) {
  const job = {
    id: crypto.randomUUID(),
    project, task,
    state: 'queued',
    exitCode: undefined,
    logTail: '',
    startedAt: new Date().toISOString(),
    finishedAt: undefined,
  };
  jobs.set(job.id, job);
  return job;
}
function appendLog(job, chunk) {
  job.logTail = (job.logTail + chunk.toString()).slice(-LOG_TAIL_BYTES);
}
function finishJob(job, state, exitCode) {
  if (job.state === 'done' || job.state === 'failed') return;
  job.state = state;
  job.exitCode = exitCode;
  job.finishedAt = new Date().toISOString();
  emit(state === 'done' ? 'job-done' : 'job-failed',
    { project: job.project, task: job.task, jobId: job.id });
}

// ---------------------------------------------------------------- path hygiene

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function projectDirFor(id) {
  if (!SAFE_ID.test(id) || id.includes('..')) return null;
  return path.join(projectsRoot, id);
}

// A relative file path from the phone: forward slashes only, no '..',
// no absolute, no backslash, no NUL, every segment sane.
function sanitizeRelPath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 1024) return null;
  if (p.includes('\\') || p.includes('\0')) return null;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return null;
  const segs = p.split('/');
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') return null;
  }
  return segs.join(path.sep);
}

// ---------------------------------------------------------------- helpers

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = MAX_IMPORT_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tiff',
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac',
  '.mp4', '.mov', '.webm', '.mkv', '.avi',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tar', '.br', '.7z', '.pdf',
  '.wasm', '.bin', '.exe', '.dylib', '.so', '.node',
]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg', '.map': 'application/json',
};

// Next free dev port: skip ports our own entries hold AND ports anything
// else on this machine already listens on (a stale dev server, another
// tool) — otherwise `serve`/`dev` die with EADDRINUSE.
function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen({ host: '127.0.0.1', port }, () => probe.close(() => resolve(true)));
  });
}
async function allocPort() {
  const used = new Set([...devByProject.values()].map((d) => d.port));
  let p = nextDevPort;
  for (let tries = 0; tries < 200; tries += 1, p += 1) {
    if (used.has(p)) continue;
    if (await portFree(p)) break;
  }
  nextDevPort = p + 1;
  return p;
}

// Probe until the dev server accepts TCP, then emit dev-up.
function watchForDevUp(entry, project, timeoutMs = 120000) {
  const started = Date.now();
  const tick = () => {
    if (devByProject.get(project) !== entry) return; // stopped meanwhile
    const sock = net.connect({ host: '127.0.0.1', port: entry.port }, () => {
      sock.destroy();
      emit('dev-up', { project, task: entry.kind, jobId: entry.jobId, port: entry.port });
    });
    sock.on('error', () => {
      sock.destroy();
      if (Date.now() - started < timeoutMs) setTimeout(tick, 500);
    });
  };
  setTimeout(tick, 300);
}

function minimalEnv(extra = {}) {
  return { PATH: process.env.PATH, HOME: process.env.HOME, ...extra };
}

function stopDevEntry(project) {
  const entry = devByProject.get(project);
  if (!entry) return false;
  devByProject.delete(project);
  if (entry.server) {
    entry.server.close();
    const job = jobs.get(entry.jobId);
    if (job) { appendLog(job, '\n[workbench] static server stopped\n'); finishJob(job, 'done', 0); }
  }
  if (entry.proc && entry.proc.pid) {
    entry.stopping = true;
    try { process.kill(-entry.proc.pid, 'SIGTERM'); } catch { try { entry.proc.kill('SIGTERM'); } catch {} }
  }
  return true;
}

// ---------------------------------------------------------------- tasks

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function spawnJob(job, cmd, args, cwd, env) {
  job.state = 'running';
  const proc = spawn(cmd, args, {
    cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (c) => appendLog(job, c));
  proc.stderr.on('data', (c) => appendLog(job, c));
  proc.on('error', (e) => {
    appendLog(job, `\n[workbench] spawn error: ${e.message}\n`);
    finishJob(job, 'failed', -1);
  });
  return proc;
}

async function execTask(project, task, projectDir) {
  const job = newJob(project, task);

  const pkgJson = path.join(projectDir, 'package.json');

  if (task === 'stop-dev') {
    const had = stopDevEntry(project);
    appendLog(job, had ? '[workbench] dev/serve stopped\n' : '[workbench] nothing was running\n');
    job.state = 'running';
    finishJob(job, 'done', 0);
    return job;
  }

  if (task === 'install') {
    if (!(await fileExists(pkgJson))) {
      appendLog(job, '[workbench] no package.json — nothing to install\n');
      job.state = 'running';
      finishJob(job, 'done', 0);
      return job;
    }
    const proc = spawnJob(job, 'npm', ['install', '--no-fund', '--no-audit'], projectDir, minimalEnv());
    proc.on('exit', (code) => finishJob(job, code === 0 ? 'done' : 'failed', code ?? -1));
    return job;
  }

  if (task === 'build') {
    let scripts = {};
    try { scripts = JSON.parse(await fs.readFile(pkgJson, 'utf-8')).scripts || {}; } catch {}
    if (!scripts.build) {
      appendLog(job, '[workbench] no "build" script in package.json\n');
      job.state = 'running';
      finishJob(job, 'failed', -1);
      return job;
    }
    const proc = spawnJob(job, 'npm', ['run', 'build'], projectDir, minimalEnv());
    proc.on('exit', (code) => finishJob(job, code === 0 ? 'done' : 'failed', code ?? -1));
    return job;
  }

  if (task === 'typecheck') {
    if (!(await fileExists(path.join(projectDir, 'tsconfig.json')))) {
      appendLog(job, '[workbench] no tsconfig.json — nothing to typecheck\n');
      job.state = 'running';
      finishJob(job, 'failed', -1);
      return job;
    }
    const proc = spawnJob(job, 'npx', ['tsc', '--noEmit'], projectDir, minimalEnv());
    proc.on('exit', (code) => finishJob(job, code === 0 ? 'done' : 'failed', code ?? -1));
    return job;
  }

  if (task === 'dev') {
    stopDevEntry(project); // one dev/serve per project
    let scripts = {};
    try { scripts = JSON.parse(await fs.readFile(pkgJson, 'utf-8')).scripts || {}; } catch {}
    if (!scripts.dev) {
      appendLog(job, '[workbench] no "dev" script in package.json\n');
      job.state = 'running';
      finishJob(job, 'failed', -1);
      return job;
    }
    const port = await allocPort();
    const proc = spawnJob(job, 'npm', ['run', 'dev'], projectDir, minimalEnv({ PORT: String(port) }));
    const entry = { kind: 'dev', port, jobId: job.id, proc, stopping: false };
    devByProject.set(project, entry);
    proc.on('exit', (code) => {
      if (devByProject.get(project) === entry) devByProject.delete(project);
      appendLog(job, `\n[workbench] dev exited (${code})\n`);
      finishJob(job, entry.stopping || code === 0 ? 'done' : 'failed', code ?? -1);
    });
    watchForDevUp(entry, project);
    return job;
  }

  if (task === 'serve') {
    stopDevEntry(project);
    const port = await allocPort();
    job.state = 'running';
    const server = http.createServer(async (sreq, sres) => {
      try {
        const u = new URL(sreq.url, 'http://x');
        let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
        if (rel === '') rel = 'index.html';
        const safe = sanitizeRelPath(rel);
        if (!safe) { sendJson(sres, 400, { ok: false, error: 'bad path' }); return; }
        let filePath = path.join(projectDir, safe);
        let st;
        try { st = await fs.stat(filePath); } catch { st = null; }
        if (st && st.isDirectory()) {
          filePath = path.join(filePath, 'index.html');
          try { st = await fs.stat(filePath); } catch { st = null; }
        }
        if (!st || !st.isFile()) { sendJson(sres, 404, { ok: false, error: 'not found' }); return; }
        sres.writeHead(200, {
          'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Content-Length': st.size,
          'Cache-Control': 'no-store',
        });
        createReadStream(filePath).pipe(sres);
      } catch (e) {
        sendJson(sres, 500, { ok: false, error: e.message });
      }
    });
    const entry = { kind: 'serve', port, jobId: job.id, server };
    devByProject.set(project, entry);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    }).catch((e) => {
      devByProject.delete(project);
      appendLog(job, `[workbench] serve failed: ${e.message}\n`);
      finishJob(job, 'failed', -1);
    });
    if (job.state === 'running') {
      appendLog(job, `[workbench] static server on 127.0.0.1:${port}\n`);
      emit('dev-up', { project, task: 'serve', jobId: job.id, port });
    }
    return job;
  }

  appendLog(job, `[workbench] unknown task ${task}\n`);
  job.state = 'running';
  finishJob(job, 'failed', -1);
  return job;
}

// ---------------------------------------------------------------- routes

async function handleStatus(res) {
  const projects = [];
  let names = [];
  try { names = await fs.readdir(projectsRoot, { withFileTypes: true }); } catch {}
  for (const d of names) {
    if (!d.isDirectory() || !SAFE_ID.test(d.name)) continue;
    const dev = devByProject.get(d.name);
    projects.push({
      id: d.name, name: d.name,
      devRunning: Boolean(dev),
      ...(dev ? { devPort: dev.port } : {}),
    });
  }
  sendJson(res, 200, { ok: true, version: VERSION, projectsRoot, projects });
}

async function handleImport(req, res) {
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf-8')); }
  catch (e) { sendJson(res, 400, { ok: false, error: `bad body: ${e.message}` }); return; }
  const { id, files } = body || {};
  const dir = id ? projectDirFor(id) : null;
  if (!dir) { sendJson(res, 400, { ok: false, error: 'invalid project id' }); return; }
  if (!Array.isArray(files) || files.length === 0) {
    sendJson(res, 400, { ok: false, error: 'files[] required' }); return;
  }
  // Validate every path BEFORE touching disk — reject the whole snapshot on any bad path.
  const writes = [];
  for (const f of files) {
    const safe = f && sanitizeRelPath(f.path);
    if (!safe) { sendJson(res, 400, { ok: false, error: `unsafe path: ${f && f.path}` }); return; }
    const enc = f.encoding === 'base64' ? 'base64' : 'utf-8';
    if (typeof f.content !== 'string') {
      sendJson(res, 400, { ok: false, error: `content must be a string: ${f.path}` }); return;
    }
    writes.push({ safe, data: Buffer.from(f.content, enc) });
  }
  await fs.rm(dir, { recursive: true, force: true }); // phone is truth on import
  for (const w of writes) {
    const abs = path.join(dir, w.safe);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, w.data);
  }
  sendJson(res, 200, { ok: true, dir });
}

async function walkTree(root, rel, out) {
  const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { await walkTree(root, childRel, out); continue; }
    if (!e.isFile()) continue;
    const abs = path.join(root, childRel);
    const st = await fs.stat(abs);
    if (st.size > MAX_FILE_RETURN) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (BINARY_EXT.has(ext)) {
      out.push({ path: childRel, content: (await fs.readFile(abs)).toString('base64'), encoding: 'base64' });
    } else {
      out.push({ path: childRel, content: await fs.readFile(abs, 'utf-8'), encoding: 'utf-8' });
    }
  }
}

async function handleFiles(res, id) {
  const dir = projectDirFor(id);
  if (!dir) { sendJson(res, 400, { ok: false, error: 'invalid project id' }); return; }
  if (!(await fileExists(dir))) { sendJson(res, 404, { ok: false, error: 'no such project' }); return; }
  const files = [];
  await walkTree(dir, '', files);
  sendJson(res, 200, { ok: true, id, files });
}

const TASKS = new Set(['install', 'build', 'typecheck', 'dev', 'stop-dev', 'serve']);

async function handleExec(req, res) {
  let body;
  try { body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf-8')); }
  catch (e) { sendJson(res, 400, { ok: false, error: `bad body: ${e.message}` }); return; }
  const { project, task } = body || {};
  if (!TASKS.has(task)) { sendJson(res, 400, { ok: false, error: `task not allowed: ${task}` }); return; }
  const dir = project ? projectDirFor(project) : null;
  if (!dir) { sendJson(res, 400, { ok: false, error: 'invalid project id' }); return; }
  if (!(await fileExists(dir))) { sendJson(res, 404, { ok: false, error: 'no such project' }); return; }
  const job = await execTask(project, task, dir);
  sendJson(res, 200, { ok: true, job: job.id });
}

function handleJob(res, id) {
  const job = jobs.get(id);
  if (!job) { sendJson(res, 404, { ok: false, error: 'no such job' }); return; }
  sendJson(res, 200, {
    id: job.id, project: job.project, task: job.task, state: job.state,
    ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
    logTail: job.logTail, startedAt: job.startedAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
  });
}

function pendingEvents(since) {
  return events.filter((e) => e.seq > since);
}

async function handleEvents(res, since) {
  const ready = pendingEvents(since);
  if (ready.length > 0) { sendJson(res, 200, { seq: eventSeq, events: ready }); return; }
  await new Promise((resolve) => {
    const timer = setTimeout(done, EVENT_HOLD_MS);
    function done() { clearTimeout(timer); eventWaiters.delete(done); resolve(); }
    eventWaiters.add(done);
    res.on('close', done);
  });
  if (res.writableEnded || res.destroyed) return;
  sendJson(res, 200, { seq: eventSeq, events: pendingEvents(since) });
}

const HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
]);

function handlePreview(req, res, project, restPath, query) {
  const entry = devByProject.get(project);
  if (!entry) {
    sendJson(res, 404, { ok: false, error: `no dev/serve running for project '${project}' — POST /exec {task:"dev"|"serve"} first` });
    return;
  }
  query.delete('wbt'); // never forward the token upstream
  const qs = query.toString();
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_HEADERS.has(k.toLowerCase())) headers[k] = v;
  }
  headers.host = `127.0.0.1:${entry.port}`;
  const upstream = http.request({
    host: '127.0.0.1', port: entry.port,
    method: req.method,
    path: '/' + restPath + (qs ? `?${qs}` : ''),
    headers,
  }, (ures) => {
    res.writeHead(ures.statusCode || 502, ures.headers);
    ures.pipe(res);
  });
  upstream.on('error', (e) => {
    if (!res.headersSent) {
      sendJson(res, 404, { ok: false, error: `upstream not reachable on port ${entry.port}: ${e.message}` });
    } else {
      res.destroy();
    }
  });
  req.pipe(upstream);
}

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;

    // Auth: header everywhere; ?wbt= additionally accepted on preview GETs.
    let token = req.headers['x-workbench-token'];
    const isPreview = p.startsWith('/preview/');
    if (!token && isPreview) token = u.searchParams.get('wbt') || undefined;
    if (!tokenOk(token)) { sendJson(res, 401, { ok: false, error: 'missing or bad X-Workbench-Token' }); return; }

    if (req.method === 'GET' && p === '/status') return handleStatus(res);
    if (req.method === 'POST' && p === '/projects/import') return handleImport(req, res);

    let m = p.match(/^\/projects\/([^/]+)\/files$/);
    if (req.method === 'GET' && m) return handleFiles(res, decodeURIComponent(m[1]));

    if (req.method === 'POST' && p === '/exec') return handleExec(req, res);

    m = p.match(/^\/jobs\/([^/]+)$/);
    if (req.method === 'GET' && m) return handleJob(res, decodeURIComponent(m[1]));

    if (req.method === 'GET' && p === '/events') {
      const since = Number(u.searchParams.get('since') || 0);
      return handleEvents(res, Number.isFinite(since) ? since : 0);
    }

    m = p.match(/^\/preview\/([^/]+)(?:\/(.*))?$/);
    if (m) {
      const project = decodeURIComponent(m[1]);
      if (!SAFE_ID.test(project)) { sendJson(res, 400, { ok: false, error: 'invalid project id' }); return; }
      return handlePreview(req, res, project, m[2] || '', u.searchParams);
    }

    sendJson(res, 404, { ok: false, error: `no route: ${req.method} ${p}` });
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: e.message });
    else res.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`workbench: listening on 0.0.0.0:${PORT} (projects: ${projectsRoot})`);
});
server.on('error', (e) => {
  console.error(`workbench: cannot listen on ${PORT}: ${e.message}`);
  process.exit(1);
});

function shutdown() {
  console.log('workbench: shutting down — stopping children');
  for (const project of [...devByProject.keys()]) stopDevEntry(project);
  server.close();
  // Give SIGTERM'd children a moment, then leave.
  setTimeout(() => process.exit(0), 400).unref();
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
