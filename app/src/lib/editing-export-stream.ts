import {sha256} from '@noble/hashes/sha2.js';
export type ExportSink={write:(bytes:Uint8Array)=>Promise<void>;finish:()=>Promise<void>;abort:()=>Promise<void>};
/** Do not commit a destination until every byte matches the server receipt. */
export async function streamEditingExport(response:Response,receipt:{bytes:number;sha256:string},sink:ExportSink){
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  if(!Number.isSafeInteger(receipt.bytes)||receipt.bytes<=0||receipt.bytes>1024**3||!/^[a-f0-9]{64}$/.test(receipt.sha256))throw new Error('The export receipt is invalid.');
  if(!response.ok||response.headers.get('X-Content-SHA256')!==receipt.sha256||!response.headers.get('Content-Type')?.startsWith('video/mp4'))throw new Error('The export changed or is unavailable. Export this revision again.');
  const length=response.headers.get('Content-Length');if(length!==null&&Number(length)!==receipt.bytes)throw new Error('The export size changed.');
  reader=response.body?.getReader();if(!reader)throw new Error('Streaming downloads are unavailable on this device.');
  const hash=sha256.create();let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>receipt.bytes)throw new Error('The export exceeded its expected size.');hash.update(value);await sink.write(value);}
  const digest=Array.from(hash.digest(),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(size!==receipt.bytes||digest!==receipt.sha256)throw new Error('The downloaded export did not match the verified file. Try saving again.');
  await sink.finish();
 }catch(error){await reader?.cancel().catch(()=>{});await sink.abort().catch(()=>{});throw error;}
 finally{reader?.releaseLock();}
}
