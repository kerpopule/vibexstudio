import {normalizeServerUrl} from './media-pairing';
export class DeviceEnrollmentError extends Error {}
const pending=new Map<string,Promise<string>>();
/** Never sends an owner token. Duplicate concurrent mounts share one claim. */
export function claimWorkbenchInvite(url:string,code:string):Promise<string>{
 if(normalizeServerUrl(url)!==url||!/^[A-Za-z0-9_-]{43}$/.test(code))return Promise.reject(new DeviceEnrollmentError('This pairing invitation is invalid. Ask for a new QR code.'));
 const key=url+'\n'+code,existing=pending.get(key);if(existing)return existing;
 const result=claim(url,code).finally(()=>pending.delete(key));pending.set(key,result);return result;
}
async function claim(url:string,code:string):Promise<string>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);
 try{
  const response=await fetch(url+'/pairing/claim',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',redirect:'error',signal:controller.signal,body:JSON.stringify({code,name:'VibeX Studio device'})});
  if(response.status===410)throw new DeviceEnrollmentError('This invitation expired or was already used. Open a new QR code on your server and scan it.');
  if(!response.ok)throw new DeviceEnrollmentError('Your server could not pair this device. Open a new QR code and try again.');
  const declared=Number(response.headers.get('Content-Length'));
  if(declared>8192)throw new DeviceEnrollmentError('Unexpected pairing response. Check your server address.');
  const text=await response.text();if(text.length>8192)throw new DeviceEnrollmentError('Unexpected pairing response. Check your server address.');
  const value=JSON.parse(text);
  if(value.scope!=='build-and-project-sync'||typeof value.deviceId!=='string'||!/^[0-9a-f-]{36}$/.test(value.deviceId)||typeof value.token!=='string'||!/^vibex-device-v1\.[A-Za-z0-9_-]{43}$/.test(value.token))throw new DeviceEnrollmentError('Unexpected pairing response. Update your server and try a new QR code.');
  return value.token;
 }catch(error){
  if(error instanceof DeviceEnrollmentError)throw error;
  throw new DeviceEnrollmentError('Pairing could not finish. Check your connection, then open a new QR code and try again.');
 }finally{clearTimeout(timer);}
}
