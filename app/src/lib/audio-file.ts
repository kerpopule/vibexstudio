const extensions:Record<string,string>={'audio/wav':'wav','audio/mpeg':'mp3','audio/flac':'flac','audio/ogg':'ogg','audio/mp4':'m4a'};
export function audioExtension(mimeType:string):string{
 const extension=extensions[mimeType];if(!extension)throw new Error('Unsupported audio format.');return extension;
}
/** Download provider output without sending the API key or browser cookies. */
export async function downloadSong(url:string):Promise<string>{
 const target=new URL(url);
 if(target.protocol!=='https:'||target.username||target.password||target.hash)throw new Error('Unsupported audio download URL.');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const limit=25_000_000;
 const read=async()=>{
  const response=await fetch(target.href,{credentials:'omit',redirect:'error',signal:controller.signal});
  if(!response.ok)throw new Error('Could not download the finished song. Resume this saved job to try again.');
  if(Number(response.headers.get('content-length'))>limit)throw new Error('This audio exceeds the 25 MB download limit.');
  let bytes:Uint8Array;
  if(response.body?.getReader){
   const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
   const cancel=()=>{void reader.cancel().catch(()=>{});};
   controller.signal.addEventListener('abort',cancel,{once:true});
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit)throw new Error('This audio exceeds the 25 MB download limit.');parts.push(part.value);}
    bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   }finally{controller.signal.removeEventListener('abort',cancel);cancel();}
  }else bytes=new Uint8Array(await response.arrayBuffer());
  if(!bytes.length||bytes.length>limit)throw new Error('The downloaded audio is empty or too large.');
  let binary='';for(let index=0;index<bytes.length;index+=8192)binary+=String.fromCharCode(...bytes.subarray(index,index+8192));
  return globalThis.btoa(binary);
 };
 try{return await Promise.race([read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Audio download timed out. Resume this saved job to try again.'));},60_000);})]);}
 finally{if(timer)clearTimeout(timer);controller.abort();}
}
