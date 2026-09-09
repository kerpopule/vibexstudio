import type {ConnectTool} from './core';
import {validateStoryboardInput,type StoryboardDraftInput} from '../storyboard-draft-create';
type Dependencies={server:()=>string|null;identity:(value:string)=>Promise<string>;create:(origin:string,requestId:string,input:StoryboardDraftInput,check:()=>void)=>Promise<string>};
export function createAgentStoryboardTool(deps:Dependencies):ConnectTool{return {
 name:'create_storyboard_editing_copy',requiredPermissions:['mediaRead','mediaEdit'],
 description:'Create an editable copy of a saved storyboard after the user requests it. Read every scene with read_media_collection first, using its sourceSha256 and original ID. Provide one ordered Library image/video asset and positive duration per scene; resolve missing media/timing with the user. Optional musicAssetId adds Library audio from scene one, stopping at the visual end. Requires separate editing permission. Originals stay unchanged; no rendering, generation or publication. Retry identical requestId and choices to recover the same draft. Does not consume a human pending request.',
 inputSchema:{type:'object',additionalProperties:false,required:['requestId','storyboardId','sourceSha256','title','fps','scenes'],properties:{
  requestId:{type:'string',pattern:'^[A-Za-z0-9_-]{16,80}$'},storyboardId:{type:'string',minLength:1,maxLength:240},sourceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},title:{type:'string',minLength:1,maxLength:160},fps:{type:'integer',minimum:1,maximum:60},musicAssetId:{type:'string',pattern:'^[A-Za-z0-9_-]{1,128}$'},
  scenes:{type:'array',minItems:1,maxItems:128,items:{type:'object',additionalProperties:false,required:['assetId','seconds'],properties:{assetId:{type:'string',pattern:'^[A-Za-z0-9_-]{1,128}$'},seconds:{type:'number',exclusiveMinimum:0,maximum:600}}}},
 }},handler:async(args,agent)=>{
  if(typeof args.requestId!=='string'||!/^[-A-Za-z0-9_]{16,80}$/.test(args.requestId))throw new Error('Provide a stable storyboard request ID.');
  const input={...(args.musicAssetId!==undefined?{musicAssetId:args.musicAssetId}:{}),storyboardId:args.storyboardId,sourceSha256:args.sourceSha256,title:args.title,fps:args.fps,scenes:args.scenes} as StoryboardDraftInput;
  validateStoryboardInput(input);
  const origin=deps.server();if(!origin)throw new Error('Connect Library and editing in Studio first.');
  const check=()=>{if(deps.server()!==origin)throw new Error('The server changed. Reconnect the original server and retry the same request.');};
  const requestId=await deps.identity(JSON.stringify(['studio-agent-storyboard-v1',agent.id,origin,args.requestId]));check();
  const draftId=await deps.create(origin,requestId,input,check);check();
  return {draftId,requestId:args.requestId,nextStep:'Read the timeline and its current revision before editing. Review soundtrack levels and finishing edits before requesting a render.'};
 }
};}
