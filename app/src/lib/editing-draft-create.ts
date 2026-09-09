/** Durable draft creation: the same request survives a lost response or restart. */
export type DraftRequest={requestId:string;title:string;assetIds:string[];deviceId:string};
export type DraftCreateDependencies={
 read:()=>Promise<DraftRequest|null>;write:(value:DraftRequest)=>Promise<void>;clear:()=>Promise<void>;
 device:()=>Promise<string>;id:()=>string;submit:(value:DraftRequest)=>Promise<string>;
};
export async function createOrResumeDraft(deps:DraftCreateDependencies,input?:{title:string;assetIds:string[]}):Promise<string>{
 const deviceId=await deps.device();
 let pending=await deps.read();
 if(pending&&pending.deviceId!==deviceId)throw new Error('Reconnect the original editing device to recover this draft request.');
 if(!pending){
  if(!input)throw new Error('No draft request is waiting to resume.');
  const title=input.title.trim(),assetIds=[...input.assetIds];
  if(!title||title.length>160||!assetIds.length||assetIds.length>8||new Set(assetIds).size!==assetIds.length||assetIds.some(id=>!/^[-A-Za-z0-9_]{1,128}$/.test(id)))throw new Error('Name your draft and choose up to eight different Library items.');
  pending={requestId:deps.id(),title,assetIds,deviceId};
  await deps.write(pending);
 }else if(input&&(input.title.trim()!==pending.title||JSON.stringify(input.assetIds)!==JSON.stringify(pending.assetIds))){
  throw new Error('Finish the saved draft request before starting another.');
 }
 const projectId=await deps.submit(pending);
 // Failure to clear is retryable: keep the same ID and retrieve the same draft.
 await deps.clear();
 return projectId;
}
