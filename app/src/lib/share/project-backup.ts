import {checkpointDirectorProject} from '../director-project-history';
import {decodeProjectSnapshot,encodeProjectSnapshot} from '@/lib/sync/project-snapshot';
import {newId,readSyncSnapshot,replaceSyncedProject} from '@/lib/storage/projects';

export async function prepareProjectBackup(id:string):Promise<string>{
 await checkpointDirectorProject(id);
 const raw=await readSyncSnapshot(id);
 if(!raw)throw new Error('Project not found.');
 return raw;
}
/** Restore to a fresh identity; compare-and-replace rejects even an ID collision. */
export async function restoreProjectBackup(raw:string):Promise<string>{
 const snapshot=decodeProjectSnapshot(raw);
 snapshot.meta={...snapshot.meta,id:newId(),name:`${snapshot.meta.name.slice(0,180)} (restored)`};
 await replaceSyncedProject(encodeProjectSnapshot(snapshot),null);
 return snapshot.meta.id;
}
