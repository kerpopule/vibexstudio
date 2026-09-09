import {Directory,File,Paths} from 'expo-file-system';
import {newId} from '../storage/projects';
import {mimeFor} from '../media-mime';
import {readProjectDirectoryArchive,type ArchiveInput,type ArchiveProgressHandler} from './project-directory-archive';
import {archivedAttachmentPath,prepareArchivedProjectMetadata} from './archive-project-metadata';
import {beginNativeArchive} from './archive-recovery.native';

/** Restore locally, publishing metadata last so incomplete projects stay hidden.
 * No existing project is replaced. The picker/export UI is wired separately.
 */
export async function restoreNativeProjectArchive(input:ArchiveInput,onProgress?:ArchiveProgressHandler):Promise<string>{
 const id=newId();
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('Could not create a fresh project identity.');
 const root=new Directory(Paths.document,'projects');
 if(!root.exists)root.create({intermediates:true});
 const target=new Directory(root,id);
 const operation=beginNativeArchive(),staged=operation.directory;
 let published=false,targetOwned=false;
 try{
  // Exclusive reservation: never clean or overwrite a pre-existing directory.
  target.create();targetOwned=true;operation.markRestore(target);
  const files=new Map<string,File>();
  await readProjectDirectoryArchive(input,async(path,chunks)=>{
   const file=new File(staged,path);
   if(!file.parentDirectory.exists)file.parentDirectory.create({intermediates:true});
   file.create();
   const writer=file.writableStream().getWriter();let size=0;
   const limit=path==='project.json'?1024*1024:path==='chat.json'?64*1024*1024:128*1024*1024;
   try{
    for await(const chunk of chunks){
     size+=chunk.length;
     if(size>limit)throw new Error('This archive exceeds the current restore limit: 128 MiB per file and 64 MiB of chat.');
     await writer.write(chunk);
    }
    await writer.close();
   }catch(error){await writer.abort().catch(()=>{});throw error;}
   files.set(path,file);
  },onProgress);
  const metadata=JSON.parse(await files.get('project.json')!.text());
  const chatFile=files.get('chat.json'),chat=chatFile?JSON.parse(await chatFile.text()):[];
  const prepared=await prepareArchivedProjectMetadata(metadata,chat,id,async(attachment,sourceId)=>{
   let path=archivedAttachmentPath(attachment.uri,sourceId);
   if(!path&&attachment.uri.startsWith('data:')){
    // Web projects embed attachment bytes. Match only already verified entries;
    // never fetch a remote URI or materialize an unarchived attachment.
    for(const [candidate,file] of files){
     if(!/^(files|media)\//.test(candidate)||!mimeFor(candidate).startsWith(attachment.kind+'/'))continue;
     const prefix=`data:${mimeFor(candidate)};base64,`;
     if(!attachment.uri.startsWith(prefix))continue;
     const encoded=attachment.uri.slice(prefix.length);
     if(encoded.length!==4*Math.ceil(file.size/3))continue;
     if(await file.base64()===encoded){path=candidate;break;}
    }
   }
   if(!path||!files.has(path)||!mimeFor(path).startsWith(attachment.kind+'/'))
    throw new Error('A chat attachment has no matching media inside this archive. Existing projects are unchanged.');
   return new File(target,path).uri;
  });
  // Both metadata files are sanitized before any project becomes visible.
  new File(staged,'chat.json').write(JSON.stringify(prepared.chat));
  new File(staged,'project.json').write(JSON.stringify(prepared.meta));
  for(const name of ['files','media']){
   const directory=new Directory(staged,name);
   if(directory.exists)directory.moveSync(new Directory(target,name));
  }
  new File(staged,'chat.json').moveSync(new File(target,'chat.json'));
  new File(staged,'project.json').moveSync(new File(target,'project.json'));
  published=true;
  return id;
 }finally{
  // Cleanup failures cannot turn a successfully published restore into a retry.
  try{
   if(!published&&targetOwned&&target.exists)target.delete();
   else if(published)operation.clearRestore(target);
  }catch{/* The recovery marker makes cleanup retryable on the next launch. */}
  try{operation.dispose();}catch{/* Private staging is reclaimed on the next launch. */}
 }
}
