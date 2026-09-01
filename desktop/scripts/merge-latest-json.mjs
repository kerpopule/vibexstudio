#!/usr/bin/env node
// Merge one platform into a release's updater manifest (latest.json).
//
// CI (tauri-action on the monorepo) creates latest.json with the Windows +
// Linux entries. The signed, notarized mac build happens locally
// (scripts/release-mac.sh), so this script downloads the release's current
// latest.json, adds/replaces the `darwin-aarch64` entry (url = the
// .app.tar.gz asset, signature = contents of the .sig), refreshes
// version/notes/pub_date, and re-uploads it with --clobber.
//
//   node scripts/merge-latest-json.mjs <tag> \
//     --tarball src-tauri/target/release/bundle/macos/VibeXStudio.app.tar.gz \
//     [--sig <path>.sig]              default: <tarball>.sig
//     [--platform darwin-aarch64]     the updater target key
//     [--repo kerpopule/vibexstudio]
//     [--notes <text>|--notes-file f] default: the GitHub release body
//     [--input latest.json]           fixture instead of `gh release download`
//     [--output out.json]             write here instead of uploading
//     [--dry-run]                      never talk to GitHub for uploads
//
// Zero dependencies — only `gh` on PATH when input/output aren't local.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const DEFAULT_REPO = "kerpopule/vibexstudio";

function usage(msg) {
  if (msg) console.error(`merge-latest-json: ${msg}\n`);
  console.error(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 20).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(2);
}

export function parseArgs(argv) {
  const opts = { repo: DEFAULT_REPO, platform: "darwin-aarch64", dryRun: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) usage(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case "--tarball": opts.tarball = next(); break;
      case "--sig": opts.sig = next(); break;
      case "--platform": opts.platform = next(); break;
      case "--repo": opts.repo = next(); break;
      case "--notes": opts.notes = next(); break;
      case "--notes-file": opts.notes = readFileSync(next(), "utf8"); break;
      case "--input": opts.input = next(); break;
      case "--output": opts.output = next(); break;
      case "--dry-run": opts.dryRun = true; break;
      case "-h": case "--help": usage(); break;
      default:
        if (a.startsWith("--")) usage(`unknown flag ${a}`);
        rest.push(a);
    }
  }
  opts.tag = rest[0] || process.env.TAG;
  if (!opts.tag) usage("missing <tag> (e.g. v1.2.0)");
  if (!opts.tarball) usage("missing --tarball <VibeXStudio.app.tar.gz>");
  if (!opts.sig) opts.sig = `${opts.tarball}.sig`;
  return opts;
}

function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "inherit"] });
}

/** Pure merge — exported so it can be tested against a fixture. */
export function mergeManifest(existing, { version, notes, pubDate, platform, url, signature }) {
  const manifest = existing && typeof existing === "object" ? { ...existing } : {};
  manifest.version = version;
  if (notes !== undefined) manifest.notes = notes;
  else if (typeof manifest.notes !== "string") manifest.notes = "";
  manifest.pub_date = pubDate;
  manifest.platforms = { ...(manifest.platforms || {}) };
  manifest.platforms[platform] = { signature, url };
  return manifest;
}

function assetUrl(repo, tag, file) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(basename(file))}`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const version = opts.tag.replace(/^v/, "");
  if (!existsSync(opts.tarball)) usage(`tarball not found: ${opts.tarball}`);
  if (!existsSync(opts.sig)) usage(`signature not found: ${opts.sig}`);
  const signature = readFileSync(opts.sig, "utf8").trim();
  if (!signature) usage(`signature file is empty: ${opts.sig}`);

  // 1. Current manifest: fixture, or the release asset (missing = start fresh).
  let existing = null;
  if (opts.input) {
    const raw = existsSync(opts.input) ? readFileSync(opts.input, "utf8").trim() : "";
    existing = raw ? JSON.parse(raw) : null;
  } else {
    const dir = mkdtempSync(join(tmpdir(), "latest-json-"));
    try {
      gh(["release", "download", opts.tag, "--repo", opts.repo, "--pattern", "latest.json", "--dir", dir, "--clobber"]);
      existing = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
      console.error(`merge-latest-json: merged into the release's latest.json (${Object.keys(existing.platforms || {}).join(", ") || "no platforms"})`);
    } catch {
      console.error("merge-latest-json: no latest.json on the release yet — creating one with just this platform");
    }
  }

  // 2. Notes: flag, else the release body, else keep what's there.
  let notes = opts.notes;
  if (notes === undefined && !opts.input && !opts.dryRun) {
    try {
      notes = JSON.parse(gh(["release", "view", opts.tag, "--repo", opts.repo, "--json", "body"])).body || "";
    } catch {
      /* keep existing notes */
    }
  }

  const manifest = mergeManifest(existing, {
    version,
    notes,
    pubDate: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    platform: opts.platform,
    url: assetUrl(opts.repo, opts.tag, opts.tarball),
    signature,
  });
  const text = JSON.stringify(manifest, null, 2) + "\n";

  // 3. Write or upload.
  if (opts.output) {
    writeFileSync(opts.output, text);
    console.error(`merge-latest-json: wrote ${opts.output}`);
    return;
  }
  if (opts.dryRun) {
    process.stdout.write(text);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "latest-json-up-"));
  const out = join(dir, "latest.json");
  writeFileSync(out, text);
  gh(["release", "upload", opts.tag, "--repo", opts.repo, "--clobber", out]);
  console.error(`merge-latest-json: uploaded latest.json for ${opts.tag} (${opts.platform} → ${manifest.platforms[opts.platform].url})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
