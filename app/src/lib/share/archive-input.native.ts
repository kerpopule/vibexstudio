import {File,FileMode} from 'expo-file-system';
import type {ArchiveInput} from './project-directory-archive';

/** Expo File.slice currently buffers the entire file. Use bounded handle reads. */
export function nativeArchiveInput(file:File):ArchiveInput{
 const size=file.size;
 if(!Number.isSafeInteger(size)||size<22||size>0xffffffff)throw new Error('Choose a VibeX project archive smaller than 4 GiB.');
 return {size,slice(start,end){return {async arrayBuffer(){
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>size||end-start>16*1024*1024)
   throw new Error('Invalid archive read range.');
  const handle=file.open(FileMode.ReadOnly);
  try{
   if(handle.size!==size)throw new Error('The archive changed while it was being read.');
   handle.offset=start;
   const bytes=handle.readBytes(end-start);
   if(bytes.length!==end-start)throw new Error('The archive could not be read completely.');
   return bytes.slice().buffer;
  }finally{handle.close();}
 }};}};
}
