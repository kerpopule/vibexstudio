import { beforeEach, expect, it, vi } from 'vitest';
const failure = vi.hoisted(() => ({ path: '' }));
const fs = vi.hoisted(() => new Map<string, string | null>());
vi.mock('expo-file-system', () => {
  const path = (parts: any[]) => parts.map((p) => typeof p === 'string' ? p : p.uri).join('/');
  class Directory {
    uri: string;
    constructor(...parts: any[]) { this.uri = path(parts); }
    get name() { return this.uri.split('/').pop()!; }
    get exists() { return fs.get(this.uri) === null; }
    create() { fs.set(this.uri, null); }
    list() { return [...fs].filter(([p]) => p.startsWith(`${this.uri}/`) && !p.slice(this.uri.length + 1).includes('/')).map(([p, value]) => value === null ? new Directory(p) : new File(p)); }
    delete() { for (const p of fs.keys()) if (p === this.uri || p.startsWith(`${this.uri}/`)) fs.delete(p); }
    copySync(target: Directory) { if(target.uri===failure.path)throw new Error('Copy failed'); for (const [p, value] of [...fs]) if (p === this.uri || p.startsWith(`${this.uri}/`)) fs.set(target.uri + p.slice(this.uri.length), value); }
  }
  class File {
    uri: string;
    constructor(...parts: any[]) { this.uri = path(parts); }
    get exists() { return typeof fs.get(this.uri) === 'string'; }
    get name() { return this.uri.split('/').pop()!; }
    get size() { return Buffer.byteLength(fs.get(this.uri) ?? '', 'latin1'); }
    textSync() { return fs.get(this.uri) as string; }
    base64Sync() { return Buffer.from(this.textSync(), 'latin1').toString('base64'); }
    write(value: string | Uint8Array) { if (this.uri === failure.path) { failure.path = ''; throw new Error('Disk full'); } fs.set(this.uri, typeof value === 'string' ? value : Buffer.from(value).toString('latin1')); }
    delete() { fs.delete(this.uri); }
    async text() { return fs.get(this.uri); }
  }
  return { Directory, File, Paths: { document: 'doc', cache:'cache' } };
});
beforeEach(() => {
  fs.clear(); failure.path = ''; vi.resetModules();
  for (const path of ['doc/projects', 'doc/projects/p1', 'doc/projects/p1/media']) fs.set(path, null);
  fs.set('doc/projects/p1/project.json', JSON.stringify({ id: 'p1', name: 'Original' }));
  fs.set('doc/projects/p1/media/voice.wav', 'original audio');
});
it('rolls back a failed replacement including existing local attachments', async () => {
  const { withSyncRecovery, deleteProject } = await import('../src/lib/storage/projects');
  await expect(withSyncRecovery('p1', async () => { await deleteProject('p1'); throw new Error('Disk full'); })).rejects.toThrow('Disk full');
  expect(fs.get('doc/projects/p1/media/voice.wav')).toBe('original audio');
  expect(JSON.parse(fs.get('doc/projects/p1/project.json') as string).name).toBe('Original');
});
it('recovers an interrupted transaction before listing projects on a fresh launch', async () => {
  fs.set('doc/sync-recovery', null); fs.set('doc/sync-recovery/p1', null); fs.set('doc/sync-recovery/p1/original', null);
  fs.set('doc/sync-recovery/p1/original/project.json', JSON.stringify({ id: 'p1', name: 'Recovered' }));
  fs.set('doc/sync-recovery/p1/pending', '1');
  const { listProjects } = await import('../src/lib/storage/projects');
  expect((await listProjects())[0].name).toBe('Recovered');
  expect(fs.has('doc/sync-recovery/p1/pending')).toBe(false);
});
it('keeps existing attachments after a successful file replacement', async () => {
  const { withSyncRecovery, deleteProject, writeProject } = await import('../src/lib/storage/projects');
  await withSyncRecovery('p1', async () => { await deleteProject('p1'); await writeProject({ id: 'p1', name: 'Updated' } as any); });
  expect(fs.get('doc/projects/p1/media/voice.wav')).toBe('original audio');
  expect(fs.has('doc/sync-recovery/p1/pending')).toBe(false);
});

const portable = () => ({meta:{id:'p1',name:'Received',description:'',emoji:'✨',createdAt:1,updatedAt:2},chat:[{id:'m1',role:'user' as const,text:'Picture',createdAt:1,attachments:[{kind:'image' as const,uri:'vibex-project-file:assets%2Fimage.png'}]}],files:[{path:'assets/image.png',encoding:'base64' as const,content:'aGVsbG8='},{path:'index.html',content:'New page'}]});
it('round trips native media and preserves device connections', async () => {
 const {encodeProjectSnapshot}=await import('../src/lib/sync/project-snapshot');
 const store=await import('../src/lib/storage/projects');
 fs.set('doc/projects/p1/project.json',JSON.stringify({...portable().meta,name:'Before',ai:{connectionId:'private',model:'local'}}));
 await store.replaceSyncedProject(encodeProjectSnapshot(portable()),store.readSyncSnapshot('p1'));
 expect(store.readSyncSnapshot('p1')).toBe(encodeProjectSnapshot(portable()));
 expect(JSON.parse(fs.get('doc/projects/p1/chat.json') as string)[0].attachments[0].uri).toBe('doc/projects/p1/files/assets/image.png');
 expect(fs.get('doc/projects/p1/files/assets/image.png')).toBe('hello');
 expect(JSON.parse(fs.get('doc/projects/p1/project.json') as string).ai.connectionId).toBe('private');
});
it('rejects stale replacements and rolls back a partial native write', async () => {
 const {encodeProjectSnapshot}=await import('../src/lib/sync/project-snapshot');
 const store=await import('../src/lib/storage/projects');
 fs.set('doc/projects/p1/project.json',JSON.stringify({...portable().meta,name:'Before'}));
 const before=store.readSyncSnapshot('p1');
 await expect(store.replaceSyncedProject(encodeProjectSnapshot(portable()),null)).rejects.toThrow('changed');
 failure.path='doc/projects/p1/files/index.html';
 await expect(store.replaceSyncedProject(encodeProjectSnapshot(portable()),before)).rejects.toThrow('Disk full');
 expect(store.readSyncSnapshot('p1')).toBe(before);
 expect(fs.has('doc/projects/p1/files/assets/image.png')).toBe(false);
 expect(fs.get('doc/projects/p1/media/voice.wav')).toBe('original audio');
});
it('imports missing projects and refuses external native attachments', async () => {
 const {encodeProjectSnapshot}=await import('../src/lib/sync/project-snapshot');
 const store=await import('../src/lib/storage/projects');
 fs.delete('doc/projects/p1/project.json');
 await store.replaceSyncedProject(encodeProjectSnapshot(portable()),null);
 expect(store.readSyncSnapshot('p1')).toBe(encodeProjectSnapshot(portable()));
 const chat=JSON.parse(fs.get('doc/projects/p1/chat.json') as string);chat[0].attachments[0].uri='doc/projects/other/private.png';
 fs.set('doc/projects/p1/chat.json',JSON.stringify(chat));
 expect(()=>store.readSyncSnapshot('p1')).toThrow('attachments');
});

it('does not start a replacement or mark recovery pending when backup copy fails',async()=>{
 const {withSyncRecovery}=await import('../src/lib/storage/projects');
 failure.path='doc/sync-recovery/p1/original';const replace=vi.fn();
 await expect(withSyncRecovery('p1',replace)).rejects.toThrow('Copy failed');
 expect(replace).not.toHaveBeenCalled();
 expect(fs.has('doc/sync-recovery/p1/pending')).toBe(false);
 expect(fs.get('doc/projects/p1/media/voice.wav')).toBe('original audio');
});
