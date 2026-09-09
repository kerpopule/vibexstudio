import type {ConnectTool} from './core';
type Dependencies={server:()=>string|null;identity:(text:string)=>Promise<string>;create:(origin:string,requestId:string,input:{title:string;assetIds:string[]},check:()=>void)=>Promise<string>};
export function createAgentDraftTool(deps:Dependencies):ConnectTool{return {
 name:'create_editing_draft',requiredPermissions:['mediaRead','mediaEdit'],
 description:'Create an editing draft from 1–8 Library asset IDs with separate editing permission. Images/video follow selection order; audio goes on a music track. Originals stay unchanged. Retry with the same requestId, title and ordered assetIds to retrieve the same draft, including after reconnecting. No rendering or generation. Does not consume a human’s pending draft request.',
 inputSchema:{type:'object',additionalProperties:false,required:['requestId','title','assetIds'],properties:{requestId:{type:'string',pattern:'^[A-Za-z0-9_-]{16,80}$'},title:{type:'string',minLength:1,maxLength:160},assetIds:{type:'array',minItems:1,maxItems:8,uniqueItems:true,items:{type:'string',pattern:'^[A-Za-z0-9_-]{1,128}$'}}}},
 handler:async(args,agent)=>{
 if(typeof args.requestId!=='string'||!/^[-A-Za-z0-9_]{16,80}$/.test(args.requestId)||typeof args.title!=='string'||!args.title.trim()||args.title.trim().length>160||!Array.isArray(args.assetIds)||!args.assetIds.length||args.assetIds.length>8||new Set(args.assetIds).size!==args.assetIds.length||args.assetIds.some(id=>typeof id!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(id)))throw new Error('Provide a unique request ID, draft title and 1–8 different Library asset IDs.');
 const origin=deps.server();if(!origin)throw new Error('Connect Library and editing in Studio first.');
 const check=()=>{if(deps.server()!==origin)throw new Error('The server changed. Reconnect the original server and retry the same request.');};
 const requestId=await deps.identity(JSON.stringify(['studio-agent-draft-v1',agent.id,origin,args.requestId]));check();
 const id=await deps.create(origin,requestId,{title:args.title.trim(),assetIds:[...args.assetIds]},check);
 return {draftId:id,requestId:args.requestId,nextStep:'Read the timeline for its current revision before editing. The draft is also available in Studio.'};
 }
};}
