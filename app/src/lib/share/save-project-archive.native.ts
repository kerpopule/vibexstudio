import {checkpointDirectorProject} from '../director-project-history';
import type {ArchiveProgressHandler} from './project-directory-archive';
import {Directory,File,Paths,FileMode} from 'expo-file-system';
import {editingExportSink} from '../editing-export-sink';
import {validateProjectSnapshot} from '../sync/project-snapshot';
import {writeProjectDirectoryArchive,type ArchiveEntry} from './project-directory-archive';
import {beginNativeArchive} from './archive-recovery.native';

/** Freeze the private native project before yielding to the streaming writer. */
export async function saveNativeProjectArchive(id:string,onProgress?:ArchiveProgressHandler){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('Invalid project identity.');
 await checkpointDirectorProject(id);
 const source=new Directory(Paths.document,'projects',id);
 if(!source.exists)throw new Error('This project is no longer on this device.');
 const operation=beginNativeArchive(),staged=operation.directory;
 let sink:Awaited<ReturnType<typeof editingExportSink>>|undefined;
 let temporaryCleanupComplete=false;
 try{
  // Expo copy is synchronous. Copy only the app's documented project layout.
  // No await occurs until the snapshot has been copied, preventing other JS
  // project writers from interleaving with this capture.
  for(const entry of source.list()){
   if(entry instanceof Directory){
    if(!['files','media'].includes(entry.name))throw new Error('This project has an unsupported folder; keep its original copy.');
    entry.copySync(new Directory(staged,entry.name));
   }else{
    if(!['project.json','chat.json'].includes(entry.name))throw new Error('This project has an unsupported file; keep its original copy.');
    entry.copySync(new File(staged,entry.name));
   }
  }
  const metadata=new File(staged,'project.json');
  if(!metadata.exists||metadata.size>1024*1024)throw new Error('Project metadata is missing or too large to archive.');
  const parsed=JSON.parse(await metadata.text());
  if(parsed.id!==id)throw new Error('The project metadata identity does not match its folder.');
  metadata.write(JSON.stringify(validateProjectSnapshot({meta:parsed,chat:[],files:[]}).meta));
  sink=await editingExportSink(`vibex-project-${Date.now()}.vibexdir`,{
   mimeType:'application/zip',extension:'.vibexdir',description:'VibeX project directory archive',dialogTitle:'Save your project archive',
  });
  async function* entries(directory:Directory,prefix=''):AsyncGenerator<ArchiveEntry>{
   for(const entry of directory.list()){
    const name=prefix+entry.name;
    if(entry instanceof Directory){yield* entries(entry,name+'/');continue;}
    const limit=name==='project.json'?1024*1024:name==='chat.json'?64*1024*1024:128*1024*1024;
    if(entry.size>limit)throw new Error('This project exceeds the archive limit: 128 MiB per file and 64 MiB of chat.');
    yield {path:name,chunks:(async function*(){
     const handle=entry.open(FileMode.ReadOnly);const size=entry.size;
     try{for(let offset=0;offset<size;offset+=1024*1024){
      const expected=Math.min(size-offset,1024*1024),bytes=handle.readBytes(expected);
      if(bytes.length!==expected)throw new Error('A staged project file changed during export.');
      yield bytes;
     }}finally{handle.close();}
    })()};
   }
  }
  const receipt=await writeProjectDirectoryArchive(entries(staged),sink,onProgress);
  try{operation.dispose();temporaryCleanupComplete=true;}catch{/* A completed share must not be reported as a failed export. */}
  return {...receipt,temporaryCleanupComplete};
 }catch(error){await sink?.abort().catch(()=>{});throw error;}
 finally{
  try{operation.dispose();}catch{/* Private staging is reclaimed on the next launch. */}
 }
}
