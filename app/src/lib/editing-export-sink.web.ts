import {nativeFileExportSink} from './native-file-export';
import type {ExportSink} from '@/lib/editing-export-stream';
export async function editingExportSink(name:string,format={mimeType:'video/mp4',extension:'.mp4',description:'MP4 video',dialogTitle:'Save your edited video'}):Promise<ExportSink>{
 const native=await nativeFileExportSink(name);if(native)return native;
 const picker=(window as any).showSaveFilePicker;
 if(picker){
  const handle=await picker.call(window,{suggestedName:name,types:[{description:format.description,accept:{[format.mimeType]:[format.extension]}}]});
  const writer=await handle.createWritable();return {write:bytes=>writer.write(bytes),finish:()=>writer.close(),abort:()=>writer.abort()};
 }
 if(!navigator.storage?.getDirectory)throw new Error('This browser cannot save large exports. Open Studio in a browser with local file storage enabled.');
 const root=await navigator.storage.getDirectory(),key=`export-${Date.now()}-${Math.random().toString(36).slice(2)}${format.extension}`;
 const handle=await root.getFileHandle(key,{create:true});
 let writer:FileSystemWritableFileStream;
 try{writer=await handle.createWritable();}catch(error){await root.removeEntry(key).catch(()=>{});throw error;}
 return {write:bytes=>writer.write(new Uint8Array(bytes)),abort:async()=>{try{await writer.abort();}finally{await root.removeEntry(key);}},finish:async()=>{
  await writer.close();const uri=URL.createObjectURL(await handle.getFile());
  const link=document.createElement('a');link.href=uri;link.download=name;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>{URL.revokeObjectURL(uri);void root.removeEntry(key).catch(()=>{});},60_000);
 }};
}
