import storage from '@react-native-async-storage/async-storage';
import {falModelUrl,falQueueUrl,fetchFalQueue} from './fal-queue';
import {extractApiError} from './sse';

export type FalSongOptions={duration:30|60|120;instrumental:boolean};
export function validateFalSongOptions(value:unknown):FalSongOptions{
 const options=value as FalSongOptions;
 if(!options||![30,60,120].includes(options.duration)||typeof options.instrumental!=='boolean')throw new Error('Choose a song length and whether to include vocals.');
 return {duration:options.duration,instrumental:options.instrumental};
}
export type FalRecovery = {id:string;providerId:string;providerLabel:string;kind:'image'|'video'|'audio';prompt:string;model:string;
  songOptions?:FalSongOptions;projectId?:string;phase:'prepared'|'submitting'|'accepted';statusUrl?:string;responseUrl?:string};
const prefix='vibex.fal-request.v1.';
const pending=new Map<string,Promise<unknown>>();
function key(id:string){if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('Invalid saved creation identity.');return prefix+id;}
function parse(raw:string):FalRecovery{
 const value=JSON.parse(raw);
 if(!value||typeof value.id!=='string'||typeof value.providerId!=='string'||typeof value.providerLabel!=='string'||typeof value.prompt!=='string'||
   !['image','video','audio'].includes(value.kind)||!['prepared','submitting','accepted'].includes(value.phase))throw new Error('A saved fal.ai request could not be read.');
 key(value.id);falModelUrl(value.model);
 if(value.songOptions!==undefined){if(value.kind!=='audio')throw new Error('Song settings belong to audio requests only.');value.songOptions=validateFalSongOptions(value.songOptions);}
 if(value.projectId!==undefined&&(typeof value.projectId!=='string'||!value.projectId))throw new Error('Invalid saved project identity.');
 if(value.phase==='accepted'){falQueueUrl(value.statusUrl);falQueueUrl(value.responseUrl);}
 return value;
}
export async function listFalRequests():Promise<FalRecovery[]>{
 const keys=(await storage.getAllKeys()).filter(value=>value.startsWith(prefix));
 return (await storage.multiGet(keys)).flatMap(([name,raw])=>{if(!raw)return [];const value=parse(raw);if(key(value.id)!==name)throw new Error('Saved creation identity changed.');return [value];});
}
export async function getFalRequest(id:string):Promise<FalRecovery|null>{
 const raw=await storage.getItem(key(id));if(!raw)return null;
 const value=parse(raw);if(value.id!==id)throw new Error('Saved creation identity changed.');return value;
}
export const forgetFalRequest=(id:string)=>storage.removeItem(key(id));

/** Persist before POST, then persist acceptance before polling. Never retry an
 * ambiguous submission: fal may already be charging for the original request. */
export async function acceptFalRequest(input:Omit<FalRecovery,'phase'>,secret:string):Promise<{statusUrl:string;responseUrl:string}>{
 if(input.songOptions!==undefined){if(input.kind!=='audio')throw new Error('Song settings belong to audio requests only.');input={...input,songOptions:validateFalSongOptions(input.songOptions)};}
 const name=key(input.id);
 const run=async()=>{
  const raw=await storage.getItem(name);
  let value:FalRecovery=raw?parse(raw):{...input,phase:'prepared'};
  if(value.id!==input.id||value.providerId!==input.providerId||value.kind!==input.kind||value.projectId!==input.projectId||value.prompt!==input.prompt||value.model!==input.model||JSON.stringify(value.songOptions)!==JSON.stringify(input.songOptions))throw new Error('This saved request belongs to different generation settings.');
  if(value.phase==='accepted')return {statusUrl:value.statusUrl!,responseUrl:value.responseUrl!};
  if(value.phase==='submitting')throw new Error('Acceptance of this fal.ai request is unknown. Check your fal.ai queue before creating another job. Retry will not submit it again.');
  falModelUrl(value.model);
  await storage.setItem(name,JSON.stringify({...value,phase:'submitting'}));
  const response=await fetchFalQueue(falModelUrl(value.model),secret,{prompt:value.prompt,...(value.songOptions??{})});
  const text=await response.text();
  if(!response.ok)throw new Error(extractApiError(text,response.status));
  const accepted=JSON.parse(text);
  const statusUrl=falQueueUrl(accepted.status_url),responseUrl=falQueueUrl(accepted.response_url);
  value={...value,phase:'accepted',statusUrl,responseUrl};
  await storage.setItem(name,JSON.stringify(value));
  return {statusUrl,responseUrl};
 };
 const existing=pending.get(name);if(existing){await existing;return acceptFalRequest(input,secret);}
 const locks=typeof navigator!=='undefined'?navigator.locks:undefined;
 const operation=locks?locks.request(name,run):run();pending.set(name,operation);
 try{return await operation;}finally{if(pending.get(name)===operation)pending.delete(name);}
}
