import {Directory,File,Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type {ExportSink} from '@/lib/editing-export-stream';
export async function editingExportSink(name:string,format={mimeType:'video/mp4',extension:'.mp4',description:'MP4 video',dialogTitle:'Save your edited video'}):Promise<ExportSink>{
 if(!await Sharing.isAvailableAsync())throw new Error('File sharing is unavailable on this device.');
 const folder=new Directory(Paths.cache,'editing-exports',`${Date.now()}-${Math.random().toString(36).slice(2)}`);folder.create({intermediates:true});
 let writer:WritableStreamDefaultWriter<Uint8Array>;
 const file=new File(folder,name);
 try{file.create();writer=file.writableStream().getWriter();}catch(error){if(folder.exists)folder.delete();throw error;}
 return {write:async bytes=>{await writer.write(bytes);},finish:async()=>{await writer.close();await Sharing.shareAsync(file.uri,{mimeType:format.mimeType,dialogTitle:format.dialogTitle});},abort:async()=>{try{await writer.abort();}finally{if(folder.exists)folder.delete();}}};
}
