// These fixtures have no Sparky state; portable history has separate integration coverage.
vi.mock('../src/lib/director-project-history',()=>({checkpointDirectorProject:async()=>{}}));
import {beforeEach,it,expect,vi} from 'vitest';
import {encodeProjectSnapshot,decodeProjectSnapshot} from '../src/lib/sync/project-snapshot';
const storage=vi.hoisted(()=>({newId:vi.fn(()=> 'fresh'),readSyncSnapshot:vi.fn(),replaceSyncedProject:vi.fn()}));
vi.mock('@/lib/storage/projects',()=>storage);
import {prepareProjectBackup,restoreProjectBackup} from '../src/lib/share/project-backup';
const raw=encodeProjectSnapshot({meta:{id:'original',name:'Original',description:'',emoji:'✨',createdAt:1,updatedAt:2},chat:[{id:'m',role:'user',text:'private conversation',createdAt:1}],files:[{path:'index.html',content:'hello'}]});
beforeEach(()=>vi.clearAllMocks());
it('backs up the complete portable snapshot and rejects a missing project',async()=>{
 storage.readSyncSnapshot.mockResolvedValueOnce(raw).mockResolvedValueOnce(null);
 expect(await prepareProjectBackup('original')).toBe(raw);
 await expect(prepareProjectBackup('missing')).rejects.toThrow('not found');
});
it('restores chat and code under a new identity without replacing existing work',async()=>{
 expect(await restoreProjectBackup(raw)).toBe('fresh');
 const [saved,expected]=storage.replaceSyncedProject.mock.calls[0];
 const snapshot=decodeProjectSnapshot(saved);
 expect(expected).toBeNull();expect(snapshot.meta.id).toBe('fresh');expect(snapshot.meta.name).toBe('Original (restored)');
 expect(snapshot.chat[0].text).toBe('private conversation');expect(snapshot.files[0].content).toBe('hello');
});
it('does not write malformed backups or conceal a failed restore',async()=>{
 await expect(restoreProjectBackup('{}')).rejects.toThrow();expect(storage.replaceSyncedProject).not.toHaveBeenCalled();
 storage.replaceSyncedProject.mockRejectedValueOnce(new Error('Disk full'));
 await expect(restoreProjectBackup(raw)).rejects.toThrow('Disk full');
});
