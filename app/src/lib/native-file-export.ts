import type {ExportSink} from './editing-export-stream';
type Invoke=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
export async function nativeFileExportSink(name:string):Promise<ExportSink|null>{
 const invoke=(globalThis as unknown as {__TAURI_INTERNALS__?:{invoke?:Invoke}}).__TAURI_INTERNALS__?.invoke;
 if(!invoke)return null;
 const id=await invoke('file_export_begin',{name});
 if(id===null)throw new DOMException('Save cancelled','AbortError');
 if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw new Error('The native export could not start.');
 let sequence=0,closed=false;
 return {
  write:async bytes=>{
   if(closed)throw new Error('The export is closed.');
   for(let offset=0;offset<bytes.length;offset+=256*1024){
    await invoke('file_export_write',{id,sequence,bytes:Array.from(bytes.subarray(offset,offset+256*1024))});sequence++;
   }
  },
  finish:async()=>{if(closed)throw new Error('The export is closed.');await invoke('file_export_finish',{id});closed=true;},
  abort:async()=>{if(closed)return;closed=true;await invoke('file_export_abort',{id});},
 };
}
