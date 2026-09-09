import {beginNativeAssetImport,cleanupNativeAssetImports} from './asset-import-recovery.native';
import {validateBinaryImport,conflictingImportPath,assertIdenticalImportStream} from './binary-import';
import {iosProjectAttachmentPath} from '@/lib/storage/native-attachment-path';
import {cleanupNativeArchives} from '../share/archive-recovery.native';
/**
 * Project storage on the device filesystem.
 *
 * Layout (under the app's document directory, backed up by the OS):
 *   projects/
 *     <id>/
 *       project.json   — ProjectMeta
 *       chat.json      — ChatMessage[]
 *       files/         — the generated web app (index.html, ...)
 *       media/         — generated images/videos referenced by chat
 */
import { Directory, File, FileMode, Paths } from 'expo-file-system';

import {decodeProjectSnapshot,encodeFileBackedSnapshot,materializeSnapshotChat} from '@/lib/sync/project-snapshot';
import type { ChatMessage, ProjectFile, ProjectMeta } from '@/lib/types';

/**
 * First-release storage is deliberately local-only. Ordinary OS file sharing,
 * import, export, and Android's user-picked folder sync remain separate paths.
 */
const localRoot = () => new Directory(Paths.document, 'projects');
const projectsRoot = localRoot;

/** Root of the on-device Media Lab gallery. */
export function mediaLabRoot(): Directory {
  const dir = new Directory(Paths.document, 'media-lab');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function projectDir(id: string): Directory {
  return new Directory(projectsRoot(), id);
}

function filesDir(id: string): Directory {
  return new Directory(projectDir(id), 'files');
}

export function mediaDir(id: string): Directory {
  const dir = new Directory(projectDir(id), 'media');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function filesRootUri(id: string): string {
  return filesDir(id).uri;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

let syncRecoveryChecked = false;
const recoveryRoot = () => new Directory(Paths.document, 'sync-recovery');

/** Roll back an interrupted replacement before exposing projects to the app. */
function recoverSyncReplacements(): void {
  if (syncRecoveryChecked) return;
  const root = recoveryRoot();
  if (root.exists) for (const entry of root.list()) {
    if (!(entry instanceof Directory)) continue;
    const marker = new File(entry, 'pending');
    if (!marker.exists) continue;
    const id = entry.name;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid sync recovery project.');
    const target = projectDir(id);
    const backup = new Directory(entry, 'original');
    if (target.exists) target.delete();
    if (backup.exists) backup.copySync(target);
    marker.delete();
  }
  syncRecoveryChecked = true;
}

/** Save the entire local directory, including attachments, before replacing it. */
export async function withSyncRecovery(id: string, replace: () => Promise<void>): Promise<void> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid sync project ID.');
  recoverSyncReplacements();
  const root = recoveryRoot();
  if (!root.exists) root.create({ intermediates: true });
  const journal = new Directory(root, id);
  if (journal.exists) journal.delete();
  journal.create();
  const target = projectDir(id);
  const backup = new Directory(journal, 'original');
  if (target.exists) target.copySync(backup);
  // The marker is written only after the complete original was copied.
  const marker = new File(journal, 'pending');
  marker.write('1');
  try {
    await replace();
    // Sync excludes chat-media today; keep this device's attachments available.
    const originalMedia = new Directory(backup, 'media');
    const currentMedia = new Directory(projectDir(id), 'media');
    if (originalMedia.exists && !currentMedia.exists) originalMedia.copySync(currentMedia);
    marker.delete();
  } catch (error) {
    syncRecoveryChecked = false;
    recoverSyncReplacements();
    throw error;
  }
}

export async function listProjects(): Promise<ProjectMeta[]> {
  cleanupNativeArchives();
  recoverSyncReplacements();
  cleanupNativeAssetImports();
  const root = projectsRoot();
  if (!root.exists) return [];
  const metas: ProjectMeta[] = [];
  for (const entry of root.list()) {
    if (!(entry instanceof Directory)) continue;
    const metaFile = new File(entry, 'project.json');
    if (!metaFile.exists) continue;
    try {
      metas.push(JSON.parse(await metaFile.text()) as ProjectMeta);
    } catch {
      // Skip corrupt project metadata rather than failing the whole list.
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readProject(id: string): Promise<ProjectMeta | null> {
  const metaFile = new File(projectDir(id), 'project.json');
  if (!metaFile.exists) return null;
  try {
    return JSON.parse(await metaFile.text()) as ProjectMeta;
  } catch {
    return null;
  }
}

export async function writeProject(meta: ProjectMeta): Promise<void> {
  const dir = projectDir(meta.id);
  if (!dir.exists) dir.create({ intermediates: true });
  new File(dir, 'project.json').write(JSON.stringify(meta, null, 2));
}

export async function createProject(name: string, emoji: string): Promise<ProjectMeta> {
  const now = Date.now();
  const meta: ProjectMeta = {
    id: newId(),
    name,
    emoji,
    description: '',
    createdAt: now,
    updatedAt: now,
  };
  await writeProject(meta);
  filesDir(meta.id).create({ intermediates: true });
  await writeChat(meta.id, []);
  return meta;
}

/** Total bytes a project occupies on disk (files, chat, media, meta). */
export async function projectSizeBytes(id: string): Promise<number> {
  return dirSizeBytes(projectDir(id));
}

function dirSizeBytes(dir: Directory): number {
  if (!dir.exists) return 0;
  let total = 0;
  for (const entry of dir.list()) {
    if (entry instanceof Directory) total += dirSizeBytes(entry);
    else total += entry.size ?? 0;
  }
  return total;
}

export async function deleteProject(id: string): Promise<void> {
  const dir = projectDir(id);
  if (dir.exists) dir.delete();
}

export async function touchProject(id: string): Promise<void> {
  const meta = await readProject(id);
  if (!meta) return;
  meta.updatedAt = Date.now();
  await writeProject(meta);
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export async function readChat(id: string): Promise<ChatMessage[]> {
  const file = new File(projectDir(id), 'chat.json');
  if (!file.exists) return [];
  try {
    const messages=JSON.parse(await file.text()) as ChatMessage[];
    return messages.map(message=>({...message,...(message.attachments?{attachments:message.attachments.map(attachment=>{
      const relative=iosProjectAttachmentPath(attachment.uri,id);
      if(!relative)return attachment;
      const current=new File(projectDir(id),...relative.split('/'));
      return current.exists?{...attachment,uri:current.uri}:attachment;
    })}:{})}));
  } catch {
    return [];
  }
}

export async function writeChat(id: string, messages: ChatMessage[]): Promise<void> {
  const dir = projectDir(id);
  if (!dir.exists) dir.create({ intermediates: true });
  new File(dir, 'chat.json').write(JSON.stringify(messages));
}

// ---------------------------------------------------------------------------
// App files
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'mp3', 'mp4', 'wav', 'flac', 'ogg', 'm4a', 'webm', 'mov', 'mkv', 'glb', 'pdf', 'zip', 'avif', 'woff', 'woff2', 'ttf']);

export function isBinaryPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

function collectFiles(dir: Directory, prefix: string, out: ProjectFile[]): Promise<void>[] {
  const pending: Promise<void>[] = [];
  for (const entry of dir.list()) {
    if (entry instanceof Directory) {
      pending.push(...collectFiles(entry, `${prefix}${entry.name}/`, out));
    } else {
      const path = `${prefix}${entry.name}`;
      if (isBinaryPath(path)) {
        pending.push(
          entry.base64().then((content) => {
            out.push({ path, content, encoding: 'base64' });
          })
        );
      } else {
        pending.push(
          entry.text().then((content) => {
            out.push({ path, content, encoding: 'utf-8' });
          })
        );
      }
    }
  }
  return pending;
}

export async function listFiles(id: string): Promise<ProjectFile[]> {
  const dir = filesDir(id);
  if (!dir.exists) return [];
  const out: ProjectFile[] = [];
  await Promise.all(collectFiles(dir, '', out));
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export interface ProjectFileManifestEntry {
  path: string;
  encoding: 'utf-8' | 'base64';
  bytes: number;
}

function collectFileManifest(dir: Directory, prefix: string, out: ProjectFileManifestEntry[]): void {
  for (const entry of dir.list()) {
    if (entry instanceof Directory) {
      collectFileManifest(entry, `${prefix}${entry.name}/`, out);
    } else {
      const path = `${prefix}${entry.name}`;
      out.push({ path, encoding: isBinaryPath(path) ? 'base64' : 'utf-8', bytes: entry.size });
    }
  }
}

/** Metadata-only listing for agent manifests; file contents are never loaded. */
export async function listProjectFileManifest(id: string): Promise<ProjectFileManifestEntry[]> {
  const dir = filesDir(id);
  if (!dir.exists) return [];
  const out: ProjectFileManifestEntry[] = [];
  collectFileManifest(dir, '', out);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function assertProjectFilePathContained(id: string, path: string): void {
  const root = filesDir(id).uri.replace(/\/?$/, '/');
  const target = new File(filesDir(id), ...path.split('/')).uri;
  if (!target.startsWith(root)) {
    throw new Error('Project path resolves outside the project root.');
  }
}

export async function getProjectFileInfo(id: string, path: string): Promise<ProjectFileManifestEntry | null> {
  assertProjectFilePathContained(id, path);
  const file = new File(filesDir(id), ...path.split('/'));
  if (!file.exists) return null;
  return { path, encoding: isBinaryPath(path) ? 'base64' : 'utf-8', bytes: file.size };
}

export async function readFile(id: string, path: string): Promise<string | null> {
  assertProjectFilePathContained(id, path);
  const file = new File(filesDir(id), ...path.split('/'));
  if (!file.exists) return null;
  return file.text();
}

/** Strict Agent Connect read: malformed UTF-8 is rejected, never replaced or base64-encoded. */
export async function readAgentUtf8File(id: string, path: string): Promise<string | null> {
  assertProjectFilePathContained(id, path);
  const file = new File(filesDir(id), ...path.split('/'));
  if (!file.exists) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(await file.bytes());
  } catch {
    throw new Error('read_project_file supports valid UTF-8 text files only.');
  }
}

export async function writeFile(id: string, path: string, content: string): Promise<void> {
  writeFileWithoutTouch(id, path, content);
  await touchProject(id);
}

/** Internal transaction primitive: callers must touch metadata after commit. */
export function writeFileWithoutTouch(id: string, path: string, content: string): void {
  assertProjectFilePathContained(id, path);
  const segments = path.split('/').filter(Boolean);
  let dir = filesDir(id);
  if (!dir.exists) dir.create({ intermediates: true });
  for (const segment of segments.slice(0, -1)) {
    dir = new Directory(dir, segment);
    if (!dir.exists) dir.create();
  }
  new File(dir, segments[segments.length - 1]).write(content);
}

export async function deleteFile(id: string, path: string): Promise<void> {
  deleteFileWithoutTouch(id, path);
  await touchProject(id);
}

/** Internal transaction primitive: callers must touch metadata after commit. */
export function deleteFileWithoutTouch(id: string, path: string): void {
  assertProjectFilePathContained(id, path);
  const file = new File(filesDir(id), ...path.split('/'));
  if (file.exists) file.delete();
}

/**
 * Write a binary (base64) asset into the project's files tree (e.g.
 * assets/img-1.png) so generated apps can reference it; returns its URI.
 */
export async function writeBinaryFile(id: string, path: string, base64: string): Promise<string> {
  assertProjectFilePathContained(id, path);
  const segments = path.split('/').filter(Boolean);
  let dir = filesDir(id);
  if (!dir.exists) dir.create({ intermediates: true });
  for (const segment of segments.slice(0, -1)) {
    dir = new Directory(dir, segment);
    if (!dir.exists) dir.create();
  }
  const file = new File(dir, segments[segments.length - 1]);
  file.write(base64ToBytes(base64));
  await touchProject(id);
  return file.uri;
}

/** Write a binary (base64) asset into the project's media dir; returns its URI. */
export function writeMedia(id: string, name: string, base64: string): string {
  const file = new File(mediaDir(id), name);
  file.write(base64ToBytes(base64));
  return file.uri;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function listProjectFilePaths(id: string): Promise<string[]> {
  return (await listProjectFileManifest(id)).map((file)=>file.path);
}


/** Capture native content synchronously so an in-app edit cannot interleave the snapshot. */
export function readSyncSnapshot(id:string):string|null {
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('Invalid sync project identity.');
 recoverSyncReplacements();
 const metaFile=new File(projectDir(id),'project.json');if(!metaFile.exists)return null;
 const chatFile=new File(projectDir(id),'chat.json');
 let bytes=metaFile.size+(chatFile.exists?chatFile.size:0);
 if(bytes>25_000_000)throw new Error('This project is too large to sync.');
 const files:ProjectFile[]=[];
 const collect=(dir:Directory,prefix:string)=>{
  if(!dir.exists)return;
  for(const entry of dir.list()){
   if(entry instanceof Directory)collect(entry,prefix+entry.name+'/');
   else{
    if(files.length>=500)throw new Error('This project has too many files to sync.');
    bytes+=entry.size;if(bytes>25_000_000)throw new Error('This project is too large to sync.');
    const path=prefix+entry.name,binary=isBinaryPath(path);
    files.push({path,encoding:binary?'base64':'utf-8',content:binary?entry.base64Sync():entry.textSync()});
   }
  }
 };
 collect(filesDir(id),'');
 const meta=JSON.parse(metaFile.textSync());if(meta.id!==id)throw new Error('Project identity does not match its storage.');
 return encodeFileBackedSnapshot({meta,chat:chatFile.exists?JSON.parse(chatFile.textSync()):[],files},path=>new File(filesDir(id),...path.split('/')).uri);
}

/** Native counterpart of desktop's compare-and-replace, protected by the recovery journal. */
export async function replaceSyncedProject(raw:string,expected:string|null):Promise<void>{
 const incoming=decodeProjectSnapshot(raw),id=incoming.meta.id;
 if(readSyncSnapshot(id)!==expected)throw new Error('This project changed while syncing. Review its copies again.');
 const metaFile=new File(projectDir(id),'project.json');const current:ProjectMeta|null=metaFile.exists?JSON.parse(metaFile.textSync()):null;
 const chat=materializeSnapshotChat(incoming,path=>new File(filesDir(id),...path.split('/')).uri);
 await withSyncRecovery(id,async()=>{
  // All mutation is synchronous inside this callback. No JavaScript edits can
  // interleave while the recovery journal guards the filesystem replacement.
  const target=projectDir(id);if(target.exists)target.delete();target.create({intermediates:true});
  for(const file of incoming.files){
   let dir=filesDir(id);if(!dir.exists)dir.create({intermediates:true});
   const segments=file.path.split('/');
   for(const segment of segments.slice(0,-1)){dir=new Directory(dir,segment);if(!dir.exists)dir.create();}
   new File(dir,segments[segments.length-1]).write(file.encoding==='base64'?base64ToBytes(file.content):file.content);
  }
  new File(target,'chat.json').write(JSON.stringify(chat));
  new File(target,'project.json').write(JSON.stringify({...incoming.meta,...(current?.ai?{ai:current.ai}:{}),...(current?.github?{github:current.github}:{})}));
  if(readSyncSnapshot(id)!==encodeFileBackedSnapshot(incoming,path=>new File(filesDir(id),...path.split('/')).uri))throw new Error('Could not verify the received project.');
 });
}

/** Commit one complete asset without rewriting unrelated files or chat. */
export async function importBinaryAssetExclusive(id:string,path:string,bytes:Uint8Array,createdAt:number):Promise<{alreadyImported:boolean}> {
 validateBinaryImport(id,path,bytes,createdAt);
 recoverSyncReplacements();assertProjectFilePathContained(id,path);
 const metaFile=new File(projectDir(id),'project.json');
 if(!metaFile.exists)throw new Error('The project changed or was removed.');
 const meta=JSON.parse(metaFile.textSync()) as ProjectMeta;
 if(meta.id!==id||meta.createdAt!==createdAt)throw new Error('The project changed or was removed.');
 const manifest:ProjectFileManifestEntry[]=[];
 if(filesDir(id).exists)collectFileManifest(filesDir(id),'',manifest);
 const matches=manifest.filter(file=>conflictingImportPath(file.path,path));
 if(matches.length){
  const file=matches[0];
  if(matches.length!==1||file.path!==path)throw new Error('A file or folder already uses this name. Choose a new path.');
  if(file.encoding!=='base64')throw new Error('That path belongs to a text file. Choose a new asset path.');
  if(file.bytes!==bytes.length)throw new Error(`The saved file size (${file.bytes} bytes) differs from the Library asset (${bytes.length} bytes). Nothing was overwritten.`);
  assertIdenticalImportStream(new File(filesDir(id),...path.split('/')).open(FileMode.ReadOnly),bytes);
  return {alreadyImported:true};
 }
 const stage=beginNativeAssetImport(projectDir(id)),temporary=stage.file;
 try{
  temporary.write(bytes);
  if(temporary.size!==bytes.length)throw new Error('The asset did not save completely.');
  const segments=path.split('/');let dir=filesDir(id);
  if(!dir.exists)dir.create({intermediates:true});
  for(const segment of segments.slice(0,-1)){dir=new Directory(dir,segment);if(!dir.exists)dir.create();}
  const target=new File(dir,segments[segments.length-1]);
  if(target.exists)throw new Error('That project file already exists. Choose a new path.');
  temporary.move(target);
  metaFile.write(JSON.stringify({...meta,updatedAt:Date.now()}));
  return {alreadyImported:false};
 }finally{stage.dispose();}
}
