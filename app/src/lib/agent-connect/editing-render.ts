import type {ConnectTool} from './core';
import type {EditingExportJob} from '../remote-editing';
type Dependencies={server:()=>string|null;start:(origin:string,id:string,revision:number,check:()=>void)=>Promise<EditingExportJob>;read:(origin:string,id:string,revision:number)=>Promise<EditingExportJob>};
export function createEditingRenderTools(deps:Dependencies):ConnectTool[]{
 return [true,false].map(start=>({
  name:start?'start_editing_export':'read_editing_export_job',
  requiredPermissions:start?['mediaRead','mediaRender']:['mediaRead'],
  description:start?'Render a saved video draft revision with separate rendering consent. Uses the connected server CPU and disk. Returns quickly; poll read_editing_export_job. Repeating the same draft/revision reuses its running or verified completed export. No publication, Library copy or download. Disconnecting does not cancel admitted work.':'Read an export job state and verified receipt metadata. Does not render or read media bytes. Failed/interrupted jobs require an explicit retry; a busy server rejects new work rather than queueing it.',
  inputSchema:{type:'object',additionalProperties:false,required:['draftId','revision'],properties:{draftId:{type:'string',pattern:'^cut-(?:[a-f0-9]{10}|[a-f0-9]{32})$'},revision:{type:'integer',minimum:0,maximum:1_000_000_000}}},
  handler:async args=>{
   if(typeof args.draftId!=='string'||!/^cut-(?:[a-f0-9]{10}|[a-f0-9]{32})$/.test(args.draftId)||!Number.isSafeInteger(args.revision)||Number(args.revision)<0||Number(args.revision)>1_000_000_000)throw new Error('Choose a saved draft and revision.');
   const origin=deps.server();if(!origin)throw new Error('Connect editing in Studio first.');
   const check=()=>{if(deps.server()!==origin)throw new Error('The server changed. Reconnect the original server and check this draft revision before retrying.');};
   const job=await (start?deps.start(origin,args.draftId,Number(args.revision),check):deps.read(origin,args.draftId,Number(args.revision)));check();
   const receipt=job.receipt;
   return {draftId:args.draftId,revision:args.revision,state:job.state,receipt:receipt?{bytes:receipt.bytes,sha256:receipt.sha256,seconds:receipt.seconds,width:receipt.width,height:receipt.height,fps:receipt.fps,mimeType:receipt.mimeType}:null};
  }
 }));
}

export function createSaveEditingExportTool(deps:{server:()=>string|null;save:(origin:string,id:string,revision:number,check:()=>void)=>Promise<string>}):ConnectTool{return {
 name:'save_editing_export_to_library',requiredPermissions:['mediaRead','mediaRender'],
 description:'Save an already verified draft export (up to 256 MiB) in the connected server Library. Requires rendering-and-saving consent. Does not render, publish, or download bytes to Studio. Retry the same revision to recover its content-based asset ID. Use import_media_asset separately to copy assets up to 16 MiB into project files.',
 inputSchema:{type:'object',additionalProperties:false,required:['draftId','revision'],properties:{draftId:{type:'string',pattern:'^cut-(?:[a-f0-9]{10}|[a-f0-9]{32})$'},revision:{type:'integer',minimum:0,maximum:1_000_000_000}}},
 handler:async args=>{
  if(typeof args.draftId!=='string'||!/^cut-(?:[a-f0-9]{10}|[a-f0-9]{32})$/.test(args.draftId)||!Number.isSafeInteger(args.revision)||Number(args.revision)<0||Number(args.revision)>1_000_000_000)throw new Error('Choose a saved draft and revision.');
  const origin=deps.server();if(!origin)throw new Error('Connect Library and editing in Studio first.');
  const check=()=>{if(deps.server()!==origin)throw new Error('The server changed. Reconnect the original server and check Library before retrying.');};
  const assetId=await deps.save(origin,args.draftId,Number(args.revision),check);check();
  return {assetId,draftId:args.draftId,revision:args.revision,kind:'video',nextStep:'Find this asset ID in list_media_assets. With separate copy permission, import_media_asset can copy it into a project if it is at most 16 MiB.'};
 }
};}
