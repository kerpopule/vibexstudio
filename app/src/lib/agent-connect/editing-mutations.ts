import {TIMELINE_COMMAND_TYPES,type TimelineCommand,type EditingTimeline} from '../editing-timeline';
import type {ConnectTool} from './core';
type Dependencies={server:()=>string|null;identity:(text:string)=>Promise<string>;apply:(origin:string,id:string,transactionId:string,input:{revision:number;commands:TimelineCommand[]},check:()=>void)=>Promise<EditingTimeline>};
export function createEditingMutationTools(deps:Dependencies):ConnectTool[]{return [{
 name:'apply_editing_commands',requiredPermissions:['mediaRead','mediaEdit'],
 description:'Apply up to 32 timeline commands with separate editing permission. Read the timeline first. Use its revision and a unique requestId; retries MUST keep the same requestId, revision and commands. Commands use frame timing, never seconds. Server rejects revision conflicts; originals stay in Library. No render, publish, or model generation. Human pending edits are not resumed or cleared.',
 inputSchema:{type:'object',additionalProperties:false,required:['draftId','requestId','revision','commands'],properties:{draftId:{type:'string',pattern:'^cut-(?:[a-f0-9]{10}|[a-f0-9]{32})$'},requestId:{type:'string',pattern:'^[A-Za-z0-9_-]{16,80}$'},revision:{type:'integer',minimum:0},commands:{type:'array',minItems:1,maxItems:32,items:{type:'object',additionalProperties:false,required:['id','type','payload'],properties:{id:{type:'string'},type:{type:'string',enum:TIMELINE_COMMAND_TYPES},payload:{type:'object',description:'clip.add: job_id (Library asset ID); clip.remove: clip_id; clip.trim: clip_id, trim_in_frames, trim_out_frames; clip.split: clip_id, at_frame, optional new_clip_id; clip.move: clip_id, track_id, start_frame; caption.add: text,start_frame,end_frame,optional caption_id; caption.edit: caption_id,text,start_frame,end_frame; caption.remove: caption_id; audio.mix: target=clip,clip_id,gain_db,muted; transition.set: from_clip_id,to_clip_id,kind,duration_frames; transition.remove: from_clip_id,to_clip_id; undo/redo: empty payload and sole command.',additionalProperties:{type:['string','number','boolean']}}}}}}},
 handler:async(args,agent)=>{
 if(typeof args.draftId!=='string'||!/^cut-(?:[a-f0-9]{10}|[a-f0-9]{32})$/.test(args.draftId)||typeof args.requestId!=='string'||!/^[-A-Za-z0-9_]{16,80}$/.test(args.requestId)||!Number.isSafeInteger(args.revision)||Number(args.revision)<0)throw new Error('Provide a draft ID, unique request ID and its saved revision.');
 const commands=args.commands;
 if(!Array.isArray(commands)||!commands.length||commands.length>32||JSON.stringify(commands).length>65536)throw new Error('Use 1–32 bounded editing commands.');
 const ids=new Set();
 for(const c of commands){if(!c||typeof c!=='object'||Object.keys(c).some(key=>!['id','type','payload'].includes(key))||typeof c.id!=='string'||!/^[-A-Za-z0-9_]{1,80}$/.test(c.id)||ids.has(c.id)||!TIMELINE_COMMAND_TYPES.includes(c.type)||!c.payload||typeof c.payload!=='object'||Array.isArray(c.payload)||Object.values(c.payload).some(value=>!['string','number','boolean'].includes(typeof value)||(typeof value==='number'&&!Number.isFinite(value))))throw new Error('Check command IDs, types and payloads against the editor command contract.');ids.add(c.id);}
 const origin=deps.server();if(!origin)throw new Error('Connect editing in Studio first.');
 const check=()=>{if(deps.server()!==origin)throw new Error('The server changed. Reconnect the original server and retry the same request.');};
 const transactionId=await deps.identity(JSON.stringify(['studio-agent-edit-v1',agent.id,origin,args.draftId,args.requestId]));check();
 const result=await deps.apply(origin,args.draftId,transactionId,{revision:Number(args.revision),commands:commands as TimelineCommand[]},check);
 return {draftId:result.id,revision:result.revision,requestId:args.requestId,canUndo:result.canUndo,nextStep:'Read the timeline to inspect the saved edit. Use Studio to preview or export.'};
 }
}];}
