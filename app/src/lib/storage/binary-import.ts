import {assertSafePath} from '@/lib/share/bundle';
export const MAX_BINARY_IMPORT_BYTES=128*1024*1024;
export function validateBinaryImport(id:string,path:string,bytes:Uint8Array,createdAt:number):void {
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!Number.isFinite(createdAt))throw new Error('Invalid project identity.');
 if(assertSafePath(path)!==path||!path.startsWith('assets/')||path.length>180)throw new Error('Choose a relative path inside assets/.');
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_BINARY_IMPORT_BYTES)throw new Error('Choose a non-empty asset no larger than 128 MiB.');
}
export function conflictingImportPath(existing:string,target:string):boolean {
 const a=existing.normalize('NFC').toLowerCase(),b=target.normalize('NFC').toLowerCase();
 return a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
}
export function binaryImportBase64(bytes:Uint8Array):string {
 const parts:string[]=[];
 // Every non-final chunk is a multiple of three, so concatenated base64 is valid.
 for(let offset=0;offset<bytes.length;offset+=24576)parts.push(btoa(String.fromCharCode(...bytes.subarray(offset,offset+24576))));
 return parts.join('');
}
/** A partial read must never be mistaken for an identical retry. */
export function assertIdenticalImportBytes(existing:Uint8Array,incoming:Uint8Array):void {
 if(existing.byteLength!==incoming.byteLength)throw new Error('The saved file has a different byte count. Choose a new path; the existing file was not changed.');
 for(let index=0;index<existing.byteLength;index++){
  if(existing[index]!==incoming[index])throw new Error('The saved file has different content. Choose a new path; the existing file was not changed.');
 }
}

export interface BinaryImportReader {readBytes(length:number):Uint8Array;close():void}
/** Verify an existing native file with at most 64 KiB of extra read memory. */
export function assertIdenticalImportStream(reader:BinaryImportReader,incoming:Uint8Array):void {
 try{
  let offset=0;
  while(offset<incoming.byteLength){
   const requested=Math.min(65536,incoming.byteLength-offset),chunk=reader.readBytes(requested);
   if(!chunk.byteLength||chunk.byteLength>requested)throw new Error('The saved file could not be read completely. Retry the import; nothing was overwritten.');
   assertIdenticalImportBytes(chunk,incoming.subarray(offset,offset+chunk.byteLength));
   offset+=chunk.byteLength;
  }
  if(reader.readBytes(1).byteLength)throw new Error('The saved file has a different byte count. Choose a new path; the existing file was not changed.');
 }finally{reader.close();}
}
