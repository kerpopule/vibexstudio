/** Credential-bearing queue requests stay on fal's documented HTTPS origin. */
export function falQueueUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('fal.ai returned an invalid queue address.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('fal.ai returned an invalid queue address.'); }
  if (url.origin !== 'https://queue.fal.run' || url.username || url.password || url.hash) {
    throw new Error('fal.ai returned an unexpected queue address. No API key was sent to it.');
  }
  return url.href;
}

export function falModelUrl(model: string): string {
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(model) ||
      model.length > 512 || model.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('Choose a valid fal.ai model before generating.');
  }
  return falQueueUrl(`https://queue.fal.run/${model}`);
}

export type FalQueueResponse = {ok:boolean;status:number;text:()=>Promise<string>};
const MAX_QUEUE_BYTES=2*1024*1024;

/** Bound the complete JSON response, including a stalled body. Never retries a
 * submission: a lost response may still represent paid work. */
export async function fetchFalQueue(url: string, secret: string, body?: {prompt: string}): Promise<FalQueueResponse> {
  const address = falQueueUrl(url);
  const controller = new AbortController();
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let timeout:ReturnType<typeof setTimeout>|undefined;
  const read=async()=>{
    const response=await fetch(address, {
      method: body ? 'POST' : 'GET',
      headers: {'Content-Type':'application/json', Authorization:`Key ${secret}`},
      credentials:'omit', redirect:'error', signal:controller.signal,
      ...(body ? {body:JSON.stringify(body)} : {}),
    });
    if(controller.signal.aborted)throw new Error('Response expired');
    const length=response.headers.get('Content-Length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_QUEUE_BYTES))throw new Error('Response too large');
    let text:string;
    if(response.body?.getReader){
      reader=response.body.getReader();
      const chunks:Uint8Array[]=[];let bytes=0;
      while(true){
        const chunk=await reader.read();if(chunk.done)break;
        bytes+=chunk.value.byteLength;
        if(bytes>MAX_QUEUE_BYTES)throw new Error('Response too large');
        chunks.push(chunk.value);
      }
      const buffer=new Uint8Array(bytes);let offset=0;
      for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
      text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
    }else{
      // Native fetch implementations can expose only a buffered body. The
      // deadline still applies; enforce the same size before returning it.
      text=await response.text();
      if(new TextEncoder().encode(text).byteLength>MAX_QUEUE_BYTES)throw new Error('Response too large');
    }
    return {ok:response.ok,status:response.status,text:async()=>text};
  };
  try {
    return await Promise.race([read(),new Promise<never>((_,reject)=>{
      timeout=setTimeout(()=>{controller.abort();reject(new Error('Response expired'));},30_000);
    })]);
  } catch {
    controller.abort();
    throw new Error(body
      ? 'The fal.ai submission response could not be read. The job may still run and incur a charge. Check your fal.ai queue before starting another generation.'
      : 'Could not read this fal.ai job. Check your connection; this does not mean the generation stopped.');
  } finally {
    if(timeout!==undefined)clearTimeout(timeout);
    if(reader)void reader.cancel().catch(()=>{});
  }
}
