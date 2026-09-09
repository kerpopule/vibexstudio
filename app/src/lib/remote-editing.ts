import {TIMELINE_COMMAND_TYPES,parseEditingTimeline,type EditingTimeline,type TimelineCommand} from '@/lib/editing-timeline';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {createOrResumeDraft} from '@/lib/editing-draft-create';
import {createOrResumeStoryboard,validateStoryboardInput,type StoryboardDraftInput,type StoryboardDraftRequest} from '@/lib/storyboard-draft-create';
import * as Crypto from 'expo-crypto';
import {libraryOrigin} from '@/lib/library-core';
import {getEditingConnection,setEditingConnection,getLibraryToken,setLibraryToken} from '@/lib/storage/secrets';

type Connection = {deviceId:string;token:string|null};
export type EditingDraft = {id:string;title:string;revision:number;seconds:number;clips:number};
const pairings=new Map<string,{library:boolean;work:Promise<void>}>();
const validToken=(token:unknown,device:string):token is string=>typeof token==='string' &&
  new RegExp(`^mlab-edit-v1\\.\\d{10,12}\\.${device}\\.[a-f0-9]{64}$`).test(token);

async function connection(origin:string):Promise<Connection|null>{
 const raw=await getEditingConnection(origin);
 if(!raw)return null;
 const value=JSON.parse(raw);
 if(!/^[a-f0-9]{32}$/.test(value?.deviceId)||!(value.token===null||validToken(value.token,value.deviceId)))throw new Error('The saved editor connection could not be read.');
 return value;
}
async function request(origin:string,path:string,init:RequestInit,timeout=20_000):Promise<any>{
 const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeout);
 try{
  let response:Response;
  try{response=await fetch(libraryOrigin(origin)+path,{...init,credentials:'omit',redirect:'error',signal:controller.signal});}
  catch{throw new Error('Could not reach Media Lab. Check your server connection. If a draft request is saved, use Resume saved draft when the server is back.');}
  if(!response.ok&&path.endsWith('/transactions')){
   if(response.status===409)throw new Error('This draft changed or another edit is being prepared. Read its current revision. Retry an uncertain request with exactly the same request ID and commands.');
   if(response.status===422)throw new Error('The edit was rejected. Check command fields and frame timing. A request ID cannot be reused with different commands.');
  }
  if(!response.ok&&path==='/api/studio/editing/storyboards'&&(response.status===409||response.status===422)){
   const data=await response.json().catch(()=>null);
   if(typeof data?.detail==='string'&&data.detail.length<=500)throw new Error(data.detail);
  }
  if(!response.ok)throw new Error(response.status===401||response.status===403?'Connect with your Media Lab code to access editing drafts.':response.status===404?'This server does not offer independent editing drafts. Update it or choose another server.':response.status===409?'The server is busy or this saved request conflicts with an earlier one. Retry the same request; check server setup if it persists.':response.status===422?(path.endsWith('/preview')?'Preview could not be rendered. Check FFmpeg on your server and the preview limits: 60 seconds, 16 contiguous clips, 30 fps and 720p.':'The editor could not use these sources. Check FFprobe on your server, file types, and the 256 MB per-file limit.'):`Media Lab could not complete this request (${response.status}).`);
  return await response.json();
 }catch(error){if(controller.signal.aborted)throw new Error('Media Lab took too long. Check the server and try again.');throw error;}
 finally{clearTimeout(timer);}
}
export async function hasEditingPermission(origin:string){return Boolean((await connection(libraryOrigin(origin)))?.token);}
export async function hasEditingMediaPermission(origin:string){
 origin=libraryOrigin(origin);return Boolean((await connection(origin))?.token&&await getLibraryToken(origin));
}
export async function disconnectEditing(origin:string){
 origin=libraryOrigin(origin);const value=await connection(origin);
 if(value)await setEditingConnection(origin,JSON.stringify({...value,token:null}));
}
/** Identity is saved before pairing so renewing access finds the same drafts. */
export async function connectEditing(origin:string,code:string,options:{includeLibrary?:boolean}={}):Promise<void>{
 origin=libraryOrigin(origin);
 const includeLibrary=options.includeLibrary===true;
 const pending=pairings.get(origin);
 if(pending){
  await pending.work;
  if(!includeLibrary||pending.library)return;
  if(pairings.get(origin)===pending)pairings.delete(origin);
  return connectEditing(origin,code,options);
 }
 const pair=async()=>{
  let value=await connection(origin);
  if(!value){value={deviceId:Array.from(Crypto.getRandomBytes(16),byte=>byte.toString(16).padStart(2,'0')).join(''),token:null};await setEditingConnection(origin,JSON.stringify(value));}
  const result=await request(origin,'/api/gate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,studio_edit:true,studio_device:value.deviceId,...(includeLibrary?{studio_library:true}:{})})});
  if(result.editScope!=='editing:own'||!validToken(result.editToken,value.deviceId))throw new Error('The server returned an invalid editing permission. Update Media Lab and try again.');
  if(includeLibrary){
   if(result.scope!=='library:read'||typeof result.token!=='string'||!/^mlab-library-v1\.user\.\d{10,12}\.[a-f0-9]{24}\.[a-f0-9]{64}$/.test(result.token))throw new Error('The server did not return Library access. Update Media Lab before connecting media and editing together.');
   await setLibraryToken(origin,result.token);
  }
  await setEditingConnection(origin,JSON.stringify({...value,token:result.editToken}));
 };
 const locks=typeof navigator!=='undefined'?navigator.locks:undefined;
 const work=locks?locks.request('vibex-editing:'+origin,pair):pair();
 const active={library:includeLibrary,work};pairings.set(origin,active);
 try{await work;}finally{if(pairings.get(origin)===active)pairings.delete(origin);}
}
export async function listEditingDrafts(origin:string,preserved=false):Promise<EditingDraft[]>{
 origin=libraryOrigin(origin);const value=await connection(origin);
 if(!value?.token)throw new Error('Connect with your Media Lab code to access editing drafts.');
 const library=preserved?await getLibraryToken(origin):null;
 if(preserved&&!library)throw new Error('Connect Library to import preserved edits.');
 const data=await request(origin,preserved?'/api/studio/editing/preserved':'/api/studio/editing/projects',{headers:{Authorization:`Bearer ${value.token}`,...(library?{'X-Library-Authorization':`Bearer ${library}`}:{})}});
 if(!Array.isArray(data?.projects))throw new Error('Media Lab returned an unreadable draft list.');
 return data.projects.filter((row:any)=>/^cut-(?:[a-f0-9]{10}|[a-f0-9]{32})$/.test(row?.project_id)&&typeof row.title==='string'&&Number.isSafeInteger(row.revision)&&row.revision>=0&&Number.isFinite(row.duration_seconds)&&row.duration_seconds>=0&&Number.isSafeInteger(row.clip_count)&&row.clip_count>=0)
  .map((row:any)=>({id:row.project_id,title:row.title.slice(0,160),revision:row.revision,seconds:row.duration_seconds,clips:row.clip_count}));
}

export type PendingEditingDraft=import('@/lib/editing-draft-create').DraftRequest;
const creations=new Map<string,Promise<string>>();
const storyboardCreations=new Map<string,Promise<string>>();
export async function pendingStoryboardDraft(origin:string):Promise<StoryboardDraftRequest|null>{
 const raw=await AsyncStorage.getItem((await pendingKey(origin))+'.storyboard');if(!raw)return null;
 const value=JSON.parse(raw);validateStoryboardInput(value);
 if(!/^[a-f0-9]{32}$/.test(value.requestId)||!/^[a-f0-9]{32}$/.test(value.deviceId))throw new Error('The saved storyboard request is unreadable. Keep this device’s data and check server drafts.');
 return value;
}
export async function createStoryboardDraft(origin:string,input?:StoryboardDraftInput):Promise<string>{
 origin=libraryOrigin(origin);if(storyboardCreations.has(origin))throw new Error('Wait for the current storyboard request.');
 const work=async()=>createOrResumeStoryboard({
  read:()=>pendingStoryboardDraft(origin),write:async value=>AsyncStorage.setItem((await pendingKey(origin))+'.storyboard',JSON.stringify(value)),clear:async()=>AsyncStorage.removeItem((await pendingKey(origin))+'.storyboard'),
  device:async()=>{const value=await connection(origin);if(!value?.token)throw new Error('Connect your editor first.');return value.deviceId;},
  id:()=>Array.from(Crypto.getRandomBytes(16),byte=>byte.toString(16).padStart(2,'0')).join(''),
  submit:async pending=>{
   const value=await connection(origin),library=await getLibraryToken(origin);
   if(!value?.token||value.deviceId!==pending.deviceId||!library)throw new Error('Reconnect media and editor on the original device.');
   const {deviceId:_,...body}=pending;
   const data=await request(origin,'/api/studio/editing/storyboards',{method:'POST',headers:{Authorization:`Bearer ${value.token}`,'X-Library-Authorization':`Bearer ${library}`,'Content-Type':'application/json'},body:JSON.stringify(body)},120_000);
   const expected='cut-'+(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,'storyboard:'+pending.requestId)).slice(0,32);
   if(data?.project?.project_id!==expected)throw new Error('The saved storyboard needs verification. Resume this request.');
   return expected;
  },},input);
 const locks=typeof navigator!=='undefined'?navigator.locks:undefined;
 const promise=locks?locks.request('vibex-storyboard-create:'+origin,work):work();storyboardCreations.set(origin,promise);
 try{return await promise;}finally{if(storyboardCreations.get(origin)===promise)storyboardCreations.delete(origin);}
}
export async function forgetStoryboardDraft(origin:string):Promise<void>{
 origin=libraryOrigin(origin);if(storyboardCreations.has(origin))throw new Error('Wait for the current storyboard request.');
 const clear=async()=>AsyncStorage.removeItem((await pendingKey(origin))+'.storyboard');
 const locks=typeof navigator!=='undefined'?navigator.locks:undefined;
 if(locks)await locks.request('vibex-storyboard-create:'+origin,clear);else await clear();
}
async function pendingKey(origin:string){
 return 'vibex.editing.pending.'+await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,libraryOrigin(origin));
}
export async function pendingEditingDraft(origin:string):Promise<PendingEditingDraft|null>{
 const raw=await AsyncStorage.getItem(await pendingKey(origin));if(!raw)return null;
 const value=JSON.parse(raw);
 if(!value||!/^[a-f0-9]{32}$/.test(value.deviceId)||!/^[a-f0-9]{32}$/.test(value.requestId)||typeof value.title!=='string'||!value.title.trim()||value.title.length>160||!Array.isArray(value.assetIds)||!value.assetIds.length||value.assetIds.length>8||new Set(value.assetIds).size!==value.assetIds.length||value.assetIds.some((id:unknown)=>typeof id!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(id)))throw new Error('The saved draft request could not be read. Keep this device’s data and recover the draft from your server.');
 return value;
}
export async function createEditingDraft(origin:string,input?:{title:string;assetIds:string[]}):Promise<string>{
 origin=libraryOrigin(origin);const active=creations.get(origin);if(active)return active;
 const work=async()=>createOrResumeDraft({
  read:()=>pendingEditingDraft(origin),
  write:async value=>AsyncStorage.setItem(await pendingKey(origin),JSON.stringify(value)),
  clear:async()=>AsyncStorage.removeItem(await pendingKey(origin)),
  device:async()=>{const value=await connection(origin);if(!value?.token)throw new Error('Reconnect your editor first.');return value.deviceId;},
  id:()=>Array.from(Crypto.getRandomBytes(16),byte=>byte.toString(16).padStart(2,'0')).join(''),
  submit:async pending=>{
   const value=await connection(origin),library=await getLibraryToken(origin);
   if(!value?.token||value.deviceId!==pending.deviceId)throw new Error('Reconnect the original editing device first.');
   if(!library)throw new Error('Connect Library with your server code before creating this draft.');
   const {deviceId:_,...body}=pending;
   const data=await request(origin,'/api/studio/editing/projects',{method:'POST',headers:{Authorization:`Bearer ${value.token}`,'X-Library-Authorization':`Bearer ${library}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
   const expected='cut-'+(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,pending.requestId)).slice(0,32);
   if(data?.project?.project_id!==expected)throw new Error('The server returned an unexpected draft. Retry the saved request to recover it.');
   return expected;
  },
 },input);
 const locks=typeof navigator!=='undefined'?navigator.locks:undefined;
 const promise=locks?locks.request('vibex-editing-create:'+origin,work):work();creations.set(origin,promise);
 try{return await promise;}finally{if(creations.get(origin)===promise)creations.delete(origin);}
}
/** Forget tracking only; it does not cancel server work or delete a draft. */
export async function forgetEditingDraftRequest(origin:string):Promise<void>{
 origin=libraryOrigin(origin);
 if(creations.has(origin))throw new Error('Wait for the current request before starting over.');
 const forget=async()=>AsyncStorage.removeItem(await pendingKey(origin));
 const locks=typeof navigator!=='undefined'?navigator.locks:undefined;
 if(locks)await locks.request('vibex-editing-create:'+origin,forget);else await forget();
}

export type PendingTimelineEdit={deviceId:string;transactionId:string;revision:number;commands:TimelineCommand[]};
const edits=new Map<string,Promise<EditingTimeline>>();
function projectPath(id:string){if(!/^cut-(?:[a-f0-9]{10}|[a-f0-9]{32})$/.test(id))throw new Error('Choose a saved editing draft.');return '/api/studio/editing/projects/'+id;}
async function editKey(origin:string,id:string){projectPath(id);return (await pendingKey(origin))+'.edit.'+id;}
export async function readEditingTimeline(origin:string,id:string):Promise<EditingTimeline>{
 const value=await connection(libraryOrigin(origin));if(!value?.token)throw new Error('Reconnect your editor first.');
 const data=await request(origin,projectPath(id),{headers:{Authorization:`Bearer ${value.token}`}});
 const project=parseEditingTimeline(data.project);if(project.id!==id)throw new Error('The server returned a different draft.');return project;
}
export async function pendingTimelineEdit(origin:string,id:string):Promise<PendingTimelineEdit|null>{
 const raw=await AsyncStorage.getItem(await editKey(origin,id));if(!raw)return null;const value=JSON.parse(raw);
 if(!value||!/^[a-f0-9]{32}$/.test(value.transactionId)||!/^[a-f0-9]{32}$/.test(value.deviceId)||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.commands)||!value.commands.length||value.commands.length>32||JSON.stringify(value.commands).length>65536||value.commands.some((command:any)=>!command||!TIMELINE_COMMAND_TYPES.includes(command.type)||typeof command.id!=='string'||!command.payload||typeof command.payload!=='object'||Array.isArray(command.payload)))throw new Error('The saved edit could not be read. Keep your data and check the server draft.');
 return value;
}
export async function applyTimelineEdit(origin:string,id:string,input?:{revision:number;commands:TimelineCommand[]}):Promise<EditingTimeline>{
 origin=libraryOrigin(origin);const key=await editKey(origin,id),active=edits.get(key);if(active)return active;
 const work=async()=>{
  const value=await connection(origin);if(!value?.token)throw new Error('Reconnect your editor first.');
  let saved=await pendingTimelineEdit(origin,id);
  if(saved&&saved.deviceId!==value.deviceId)throw new Error('Reconnect the original device to resume this edit.');
  if(saved&&input)throw new Error('Resume or discard the saved edit before making another change.');
  if(!saved){
   if(!input)throw new Error('No saved edit is waiting to resume.');
   saved={...input,deviceId:value.deviceId,transactionId:Array.from(Crypto.getRandomBytes(16),byte=>byte.toString(16).padStart(2,'0')).join('')};
   await AsyncStorage.setItem(key,JSON.stringify(saved));
  }
  const {deviceId:_,...body}=saved;
  const headers:Record<string,string>={Authorization:`Bearer ${value.token}`,'Content-Type':'application/json'};
  if(saved.commands.some(command=>command.type==='clip.add')){
   const library=await getLibraryToken(origin);if(!library)throw new Error('Reconnect Library before adding media, then resume this edit.');
   headers['X-Library-Authorization']='Bearer '+library;
  }
  const result=await request(origin,projectPath(id)+'/transactions',{method:'POST',headers,body:JSON.stringify(body)});
  const project=parseEditingTimeline(result.project);if(project.id!==id||project.revision<=saved.revision)throw new Error('The saved edit needs verification. Resume it to check the result.');
  await AsyncStorage.removeItem(key);return project;
 };
 const locks=typeof navigator!=='undefined'?navigator.locks:undefined;
 const promise=locks?locks.request(key,work):work();edits.set(key,promise);
 try{return await promise;}finally{if(edits.get(key)===promise)edits.delete(key);}
}
export async function forgetTimelineEdit(origin:string,id:string){
 const key=await editKey(origin,id);if(edits.has(key))throw new Error('Wait for the current edit first.');
 const clear=()=>AsyncStorage.removeItem(key),locks=typeof navigator!=='undefined'?navigator.locks:undefined;
 if(locks)await locks.request(key,clear);else await clear();
}

export type EditingPreviewReceipt={projectId:string;revision:number;bytes:number;sha256:string;seconds:number;mimeType:'video/mp4';candidate:true};
export async function renderEditingPreview(origin:string,id:string,revision:number):Promise<EditingPreviewReceipt>{
 if(!Number.isSafeInteger(revision)||revision<0)throw new Error('Refresh the saved timeline first.');
 const value=await connection(libraryOrigin(origin));if(!value?.token)throw new Error('Reconnect your editor first.');
 const result=await request(origin,projectPath(id)+'/preview',{method:'POST',headers:{Authorization:`Bearer ${value.token}`,'Content-Type':'application/json'},body:JSON.stringify({revision})},180_000);
 if(result?.projectId!==id||result.revision!==revision||!Number.isSafeInteger(result.bytes)||result.bytes<=0||result.bytes>64*1024**2||!/^[a-f0-9]{64}$/.test(result.sha256)||!Number.isFinite(result.seconds)||result.seconds<=0||result.seconds>61||result.mimeType!=='video/mp4'||result.candidate!==true)throw new Error('Media Lab returned an unreadable preview receipt.');
 return result;
}
export async function readEditingPreview(origin:string,receipt:EditingPreviewReceipt):Promise<Uint8Array>{
 if(!Number.isSafeInteger(receipt.bytes)||receipt.bytes<=0||receipt.bytes>64*1024**2||!Number.isSafeInteger(receipt.revision)||receipt.revision<0||!/^[a-f0-9]{64}$/.test(receipt.sha256))throw new Error('The preview receipt is invalid.');
 const value=await connection(libraryOrigin(origin));if(!value?.token)throw new Error('Reconnect your editor first.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60_000);
 try{
  const response=await fetch(libraryOrigin(origin)+projectPath(receipt.projectId)+`/previews/${receipt.revision}/content`,{headers:{Authorization:`Bearer ${value.token}`},credentials:'omit',redirect:'error',signal:controller.signal});
  if(!response.ok||response.headers.get('X-Content-SHA256')!==receipt.sha256||!response.headers.get('Content-Type')?.startsWith('video/mp4'))throw new Error('This preview is unavailable or changed. Render the saved revision again.');
  const declared=response.headers.get('Content-Length');
  if(declared!==null&&Number(declared)!==receipt.bytes){await response.body?.cancel();throw new Error('The preview size changed. Render it again.');}
  const reader=response.body?.getReader?.();let bytes:Uint8Array<ArrayBuffer>;
  if(reader){
   const chunks:Uint8Array[]=[];let size=0;
   try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>receipt.bytes)throw new Error('The preview exceeded its expected size.');chunks.push(next.value);}
    if(size!==receipt.bytes)throw new Error('The preview download was incomplete.');
    bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  }else{bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==receipt.bytes)throw new Error('The preview download was incomplete.');}
  const digest=await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,bytes);
  const hex=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(hex!==receipt.sha256)throw new Error('The preview did not match its verified copy. Download it again.');
  return bytes;
 }finally{clearTimeout(timer);}
}

export type EditingExportReceipt=Omit<EditingPreviewReceipt,'seconds'> & {seconds:number;quality:'high';width:number;height:number;fps:number};
export async function renderEditingExport(origin:string,id:string,revision:number):Promise<EditingExportReceipt>{
 if(!Number.isSafeInteger(revision)||revision<0)throw new Error('Refresh the saved timeline first.');
 const value=await connection(libraryOrigin(origin));if(!value?.token)throw new Error('Reconnect your editor first.');
 const result=await request(origin,projectPath(id)+'/export',{method:'POST',headers:{Authorization:`Bearer ${value.token}`,'Content-Type':'application/json'},body:JSON.stringify({revision})},1_100_000);
 return parseEditingExportReceipt(result,id,revision);
}

function parseEditingExportReceipt(result:any,id:string,revision:number):EditingExportReceipt{
 if(result?.projectId!==id||result.revision!==revision||result.quality!=='high'||result.mimeType!=='video/mp4'||result.candidate!==true||!Number.isSafeInteger(result.bytes)||result.bytes<=0||result.bytes>1024**3||!/^[a-f0-9]{64}$/.test(result.sha256)||!Number.isFinite(result.seconds)||result.seconds<=0||result.seconds>601||![result.width,result.height,result.fps].every(n=>Number.isSafeInteger(n)&&n>0)||Math.max(result.width,result.height)>1920||result.width*result.height>1920*1080||result.fps>60)throw new Error('Media Lab returned an unreadable export receipt.');
 return result;
}
export async function readEditingExportStatus(origin:string,id:string,revision:number):Promise<EditingExportReceipt|null>{
 if(!Number.isSafeInteger(revision)||revision<0)throw new Error('Choose a saved revision.');
 const value=await connection(libraryOrigin(origin));if(!value?.token)throw new Error('Reconnect your editor first.');
 const data=await request(origin,projectPath(id)+`/exports/${revision}/status`,{headers:{Authorization:`Bearer ${value.token}`}});
 if(data?.projectId!==id||data.revision!==revision)throw new Error('The server returned a different export status.');
 if(data.state==='not-ready'&&data.receipt===null)return null;
 if(data.state!=='ready')throw new Error('The export status is unreadable.');
 return parseEditingExportReceipt(data.receipt,id,revision);
}
export async function editingExportAuthorization(origin:string){
 const value=await connection(libraryOrigin(origin));if(!value?.token)throw new Error('Reconnect your editor first.');return value.token;
}

/** Explicitly copy a picked file to the user's connected host. */
export async function uploadLibraryFile(origin:string,filename:string,bytes:Uint8Array):Promise<void>{
 origin=libraryOrigin(origin);
 if(!bytes.byteLength||bytes.byteLength>64*1024**2)throw new Error('Choose a file up to 64 MB for upload from this device.');
 const value=await connection(origin),library=await getLibraryToken(origin);
 if(!value?.token||!library)throw new Error('Connect Library and enable editing with your server access code before uploading.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),200000);
 try{
  const response=await fetch(origin+'/api/studio/library/import?filename='+encodeURIComponent(filename),{
   method:'POST',headers:{Authorization:`Bearer ${value.token}`,'X-Library-Authorization':`Bearer ${library}`,'Content-Type':'application/octet-stream'},
   credentials:'omit',redirect:'error',signal:controller.signal,body:new Uint8Array(bytes).buffer,
  });
  if(!response.ok)throw new Error(response.status===404?'Update your server to enable file uploads.':response.status===401?'Reconnect Library and editing with your access code.':response.status===413?'This file exceeds the server upload limit.':response.status===429?'Another upload is running. Try again shortly.':'The server could not import this file. Check its format and available server storage.');
  const result=await response.json();
  if(!/^import-[a-f0-9]{64}-[a-z0-9]+$/.test(result?.id)||result.bytes!==bytes.byteLength)throw new Error('The upload reply could not be verified. Refresh Library before retrying.');
 }finally{clearTimeout(timer);}
}


export async function hasLibraryUploadPermission(origin:string):Promise<boolean>{
 origin=libraryOrigin(origin);
 return Boolean((await connection(origin))?.token && await getLibraryToken(origin));
}

export async function saveExportToLibrary(origin:string,id:string,revision:number,check?:()=>void):Promise<string>{
 origin=libraryOrigin(origin);
 if(!/^cut-(?:[a-f0-9]{10}|[a-f0-9]{32})$/.test(id)||!Number.isSafeInteger(revision)||revision<0)throw new Error('Choose a saved export revision.');
 const value=await connection(origin),library=await getLibraryToken(origin);
 if(!value?.token||!library)throw new Error('Connect Library and editing before saving the export to Library.');
 check?.();
 const result=await request(origin,`/api/studio/editing/projects/${id}/exports/${revision}/library`,{
  method:'POST',headers:{Authorization:`Bearer ${value.token}`,'X-Library-Authorization':`Bearer ${library}`},
 },120000);
 if(!/^import-[a-f0-9]{64}-mp4$/.test(result?.id)||result.kind!=='video')throw new Error('The Library save reply could not be verified. Refresh Library before retrying.');
 return result.id;
}

export async function importPreservedEdit(origin:string,id:string):Promise<string>{
 origin=libraryOrigin(origin);projectPath(id);
 const value=await connection(origin),library=await getLibraryToken(origin);
 if(!value?.token||!library)throw new Error('Connect both the editor and Library before importing saved edits.');
 const data=await request(origin,`/api/studio/editing/preserved/${id}/import`,{method:'POST',headers:{Authorization:`Bearer ${value.token}`,'X-Library-Authorization':`Bearer ${library}`}});
 const project=parseEditingTimeline(data.project);
 if(project.id!==id)throw new Error('The imported project identity did not match.');
 return id;
}

/** Agent-owned request IDs use the server journal, never the human's pending edit. */
export async function applyAgentTimelineEdit(origin:string,id:string,transactionId:string,input:{revision:number;commands:TimelineCommand[]},check:()=>void):Promise<EditingTimeline>{
 origin=libraryOrigin(origin);
 if(!/^[a-f0-9]{64}$/.test(transactionId))throw new Error('Invalid agent edit identity.');
 const value=await connection(origin);if(!value?.token)throw new Error('Reconnect your editor first.');
 const headers:Record<string,string>={Authorization:`Bearer ${value.token}`,'Content-Type':'application/json'};
 if(input.commands.some(command=>command.type==='clip.add')){
  const library=await getLibraryToken(origin);if(!library)throw new Error('Connect Library before adding media.');
  headers['X-Library-Authorization']='Bearer '+library;
 }
 check();
 const result=await request(origin,projectPath(id)+'/transactions',{method:'POST',headers,body:JSON.stringify({...input,transactionId})});
 const timeline=parseEditingTimeline(result.project);
 if(timeline.id!==id||timeline.revision<=input.revision)throw new Error('Verify the draft and retry the same request ID.');
 return timeline;
}

/** Independent agent creation identity; no access to the human's pending request. */
export async function createAgentEditingDraft(origin:string,requestId:string,input:{title:string;assetIds:string[]},check:()=>void):Promise<string>{
 origin=libraryOrigin(origin);
 if(!/^[a-f0-9]{64}$/.test(requestId))throw new Error('Invalid agent draft identity.');
 const value=await connection(origin),library=await getLibraryToken(origin);
 if(!value?.token||!library)throw new Error('Connect Library and editing before creating a draft.');
 check();
 const data=await request(origin,'/api/studio/editing/projects',{method:'POST',headers:{Authorization:`Bearer ${value.token}`,'X-Library-Authorization':`Bearer ${library}`,'Content-Type':'application/json'},body:JSON.stringify({...input,requestId})});
 const expected='cut-'+(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,requestId)).slice(0,32);
 if(data?.project?.project_id!==expected)throw new Error('The server returned an unexpected draft. Retry the same request to verify it.');
 return expected;
}

export async function createAgentStoryboardDraft(origin:string,requestId:string,input:StoryboardDraftInput,check:()=>void):Promise<string>{
 origin=libraryOrigin(origin);validateStoryboardInput(input);
 if(!/^[a-f0-9]{64}$/.test(requestId))throw new Error('Invalid agent storyboard identity.');
 const value=await connection(origin),library=await getLibraryToken(origin);
 if(!value?.token||!library)throw new Error('Connect Library and editing before importing a storyboard.');
 check();
 const data=await request(origin,'/api/studio/editing/storyboards',{method:'POST',headers:{Authorization:`Bearer ${value.token}`,'X-Library-Authorization':`Bearer ${library}`,'Content-Type':'application/json'},body:JSON.stringify({...input,requestId})},120_000);
 const expected='cut-'+(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,'storyboard:'+requestId)).slice(0,32);
 if(data?.project?.project_id!==expected)throw new Error('The server returned an unexpected storyboard copy. Retry the same request to verify it.');
 return expected;
}

export interface EditingExportJob {
 projectId:string;revision:number;state:'not-ready'|'running'|'ready'|'failed'|'interrupted';receipt:EditingExportReceipt|null;
}
async function exportJobRequest(origin:string,id:string,revision:number,start:boolean,check?:()=>void):Promise<EditingExportJob>{
 if(!Number.isSafeInteger(revision)||revision<0||revision>1_000_000_000)throw new Error('Choose a saved revision.');
 const value=await connection(libraryOrigin(origin));if(!value?.token)throw new Error('Reconnect your editor first.');
 check?.();
 const data=await request(origin,projectPath(id)+'/export-jobs'+(start?'':`/${revision}`),{
  method:start?'POST':'GET',headers:{Authorization:`Bearer ${value.token}`,...(start?{'Content-Type':'application/json'}:{})},
  ...(start?{body:JSON.stringify({revision})}:{})});
 if(data?.projectId!==id||data.revision!==revision||!['not-ready','running','ready','failed','interrupted'].includes(data.state))throw new Error('The server returned an unreadable export job.');
 if(data.state!=='ready'&&data.receipt!==null)throw new Error('The server returned an inconsistent export job.');
 return {projectId:id,revision,state:data.state,receipt:data.state==='ready'?parseEditingExportReceipt(data.receipt,id,revision):null};
}
export const startEditingExportJob=(origin:string,id:string,revision:number,check?:()=>void)=>exportJobRequest(origin,id,revision,true,check);
export const readEditingExportJob=(origin:string,id:string,revision:number)=>exportJobRequest(origin,id,revision,false);
