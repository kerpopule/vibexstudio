import {checkpointDirectorProject} from '../director-project-history';
import type {ArchiveProgressHandler} from './project-directory-archive';
import {editingExportSink} from '../editing-export-sink';
import {stageProjectDirectoryArchive} from '../storage/projects.web';
import {writeProjectDirectoryArchive} from './project-directory-archive';
/** Pick the destination before staging; cancellation never copies project records.
 * Preservation archive only: this is not the existing JSON restore format.
 */
export async function saveProjectDirectoryArchive(id:string,onProgress?:ArchiveProgressHandler){
 const sink=await editingExportSink(`vibex-project-${Date.now()}.vibexdir`,{
  mimeType:'application/zip',extension:'.vibexdir',description:'VibeX project directory archive',dialogTitle:'Save your project archive',
 });
 let staged:Awaited<ReturnType<typeof stageProjectDirectoryArchive>>;
 try{await checkpointDirectorProject(id);staged=await stageProjectDirectoryArchive(id);}catch(error){await sink.abort().catch(()=>{});throw error;}
 let temporaryCleanupComplete=false;
 let receipt:Awaited<ReturnType<typeof writeProjectDirectoryArchive>>;
 try{receipt=await writeProjectDirectoryArchive((async function*(){
  for await(const entry of staged.entries){
   yield {path:entry.path,chunks:(async function*(){
    const limit=entry.path==='project.json'?1024*1024:entry.path==='chat.json'?64*1024*1024:128*1024*1024;let size=0;
    for await(const chunk of entry.chunks){size+=chunk.length;if(size>limit)throw new Error('This project exceeds the current archive restore limits: 128 MiB per file and 64 MiB of chat.');yield chunk;}
   })()};
  }
 })(),sink,onProgress);}
 finally{try{await staged.dispose();temporaryCleanupComplete=true;}catch{/* Keep a completed save distinct from temporary cleanup failure. */}}
 return {...receipt,temporaryCleanupComplete};
}
