export interface SyncConnection {url:string;token:string}
/** Fixed routes and no redirects: pairing credentials never follow a moved endpoint. */
export async function requestProjectSync(connection:SyncConnection,body?:Record<string,unknown>):Promise<any>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30_000);
 try{
  const url=new URL(connection.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Invalid paired server address.');
  const response=await fetch(connection.url.replace(/\/+$/,'')+(body?'/sync':'/status'),{method:body?'POST':'GET',headers:{'X-Workbench-Token':connection.token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal,redirect:'error'});
  if(response.status===401)throw new Error('Your server rejected this connection. Pair it again in Setup.');
  if(response.status===404)throw new Error('Project sync is not enabled on this server.');
  if(Number(response.headers.get('content-length'))>64*1024*1024)throw new Error('The server response is too large.');
  const raw=await response.text();if(raw.length>64*1024*1024)throw new Error('The server response is too large.');
  let result;try{result=JSON.parse(raw);}catch{throw new Error('The server returned an unreadable sync response.');}
  if(!response.ok)throw new Error(response.status===409?'The server changed. Sync again to review both copies.':typeof result?.error==='string'?result.error:'The server could not complete synchronization.');
  return result;
 }catch(error){if(controller.signal.aborted)throw new Error('The server took too long to respond. Your local projects are still here.');if(error instanceof TypeError)throw new Error('Could not reach your server. Check its address and network connection. Browser access also requires permission from the server for this app’s origin.');throw error;}
 finally{clearTimeout(timer);}
}
