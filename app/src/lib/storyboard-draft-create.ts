export type StoryboardDraftInput={musicAssetId?:string;storyboardId:string;sourceSha256:string;title:string;fps:number;scenes:{assetId:string;seconds:number}[]};
export type StoryboardDraftRequest=StoryboardDraftInput&{requestId:string;deviceId:string};
export function validateStoryboardInput(value:StoryboardDraftInput):void {
 if(!value||(value.musicAssetId!==undefined&&(typeof value.musicAssetId!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(value.musicAssetId)))||typeof value.storyboardId!=='string'||!value.storyboardId||value.storyboardId.length>240||!/^[a-f0-9]{64}$/.test(value.sourceSha256)||typeof value.title!=='string'||!value.title.trim()||value.title.length>160||!Number.isInteger(value.fps)||value.fps<1||value.fps>60||!Array.isArray(value.scenes)||!value.scenes.length||value.scenes.length>128||value.scenes.some(scene=>!scene||typeof scene.assetId!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(scene.assetId)||!Number.isFinite(scene.seconds)||scene.seconds<=0)||value.scenes.reduce((sum,scene)=>sum+scene.seconds,0)>600)
  throw new Error('Choose media and a positive duration for every scene, up to ten minutes total.');
}
export async function createOrResumeStoryboard(deps:{read:()=>Promise<StoryboardDraftRequest|null>;write:(value:StoryboardDraftRequest)=>Promise<void>;clear:()=>Promise<void>;device:()=>Promise<string>;id:()=>string;submit:(value:StoryboardDraftRequest)=>Promise<string>},input?:StoryboardDraftInput):Promise<string>{
 const deviceId=await deps.device();let pending=await deps.read();
 if(pending){
  validateStoryboardInput(pending);
  if(pending.deviceId!==deviceId)throw new Error('Reconnect the original editing device to resume this storyboard.');
  if(input){const {deviceId:_,requestId:__,...saved}=pending;if(JSON.stringify(saved)!==JSON.stringify(input))throw new Error('Resume the saved storyboard request before starting another.');}
 }else{
  if(!input)throw new Error('No storyboard import is waiting to resume.');
  validateStoryboardInput(input);
  pending={...input,scenes:input.scenes.map(scene=>({...scene})),deviceId,requestId:deps.id()};
  await deps.write(pending);
 }
 const id=await deps.submit(pending);await deps.clear();return id;
}
