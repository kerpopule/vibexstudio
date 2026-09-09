export const TRANSITION_STYLES={dissolve:'Dissolve',fade:'Fade',fadeblack:'Through black',fadewhite:'Through white',wipeleft:'Wipe left',wiperight:'Wipe right',slideleft:'Slide left',slideright:'Slide right'} as const;
export type TimelineTransition={from:string;to:string;kind:keyof typeof TRANSITION_STYLES;duration:number};
export type TimelineClip={id:string;label:string;start:number;duration:number;trimIn:number;trimOut:number;sourceFrames:number|null;audio?:{gain:number;muted:boolean;linked:boolean}};
export type TimelineTrack={id:string;name:string;type?:string;clips:TimelineClip[]};
export type TimelineCaption={id:string;text:string;start:number;end:number};
export type EditingTimeline={id:string;title:string;revision:number;fps:number;canUndo:boolean;canRedo:boolean;tracks:TimelineTrack[];captions?:TimelineCaption[];transitions?:TimelineTransition[]};
export const TIMELINE_COMMAND_TYPES=['clip.add','clip.remove','clip.trim','clip.split','clip.move','caption.add','caption.edit','caption.remove','audio.mix','transition.set','transition.remove','undo','redo'] as const;
export type TimelineCommand={id:string;type:typeof TIMELINE_COMMAND_TYPES[number];payload:Record<string,string|number|boolean>};
const frame=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export function parseEditingTimeline(value:any):EditingTimeline{
 if(!value||!/^cut-(?:[a-f0-9]{10}|[a-f0-9]{32})$/.test(value.project_id)||typeof value.title!=='string'||!frame(value.revision)||!Number.isInteger(value.settings?.fps)||value.settings.fps<1||value.settings.fps>120||!Array.isArray(value.timeline?.tracks)||value.timeline.tracks.length>32)throw new Error('The server returned an unreadable timeline.');
 const seen=new Set<string>();
 const tracks=value.timeline.tracks.map((track:any)=>{
  if(!id(track?.id)||typeof track.name!=='string'||!Array.isArray(track.clips)||track.clips.length>1000)throw new Error('The server returned an unreadable track.');
  const clips=track.clips.map((clip:any)=>{
   if(!id(clip?.id)||seen.has(clip.id)||!frame(clip.start_frame)||!frame(clip.duration_frames)||clip.duration_frames<1||!frame(clip.trim_in_frame)||!frame(clip.trim_out_frame)||clip.trim_out_frame-clip.trim_in_frame!==clip.duration_frames||!(clip.source_duration_frames==null||frame(clip.source_duration_frames)))throw new Error('The server returned an unreadable clip.');
   const audio=clip.audio??{gain_db:0,muted:false,linked:false};
   if(typeof audio.gain_db!=='number'||!Number.isFinite(audio.gain_db)||audio.gain_db< -60||audio.gain_db>24||typeof audio.muted!=='boolean'||typeof audio.linked!=='boolean')throw new Error('The server returned unreadable clip audio.');
   seen.add(clip.id);return {audio:{gain:audio.gain_db,muted:audio.muted,linked:audio.linked},id:clip.id,label:typeof clip.label==='string'?clip.label.slice(0,160):'Untitled clip',start:clip.start_frame,duration:clip.duration_frames,trimIn:clip.trim_in_frame,trimOut:clip.trim_out_frame,sourceFrames:clip.source_duration_frames??null};
  }).sort((a:TimelineClip,b:TimelineClip)=>a.start-b.start);
  return {type:track.type,id:track.id,name:track.name.slice(0,80),clips};
 });
 const rawCaptions=value.timeline.captions?.items??[];
 if(!Array.isArray(rawCaptions)||rawCaptions.length>1000)throw new Error('The server returned unreadable captions.');
 const captionIds=new Set<string>();
 const captions=rawCaptions.map((caption:any)=>{
  if(!id(caption?.id)||captionIds.has(caption.id)||typeof caption.text!=='string'||!frame(caption.start_frame)||!frame(caption.end_frame)||caption.end_frame<=caption.start_frame)throw new Error('The server returned an unreadable caption.');
  captionIds.add(caption.id);return {id:caption.id,text:caption.text,start:caption.start_frame,end:caption.end_frame};
 }).sort((a:TimelineCaption,b:TimelineCaption)=>a.start-b.start);
 const rawTransitions=value.timeline.transitions??[];
 if(!Array.isArray(rawTransitions)||rawTransitions.length>1000)throw new Error('The server returned unreadable transitions.');
 const transitions=rawTransitions.map((item:any)=>{
  if(!id(item?.from_clip_id)||!id(item.to_clip_id)||!Object.hasOwn(TRANSITION_STYLES,item.kind)||!frame(item.duration_frames)||item.duration_frames<1)throw new Error('The server returned an unreadable transition.');
  return {from:item.from_clip_id,to:item.to_clip_id,kind:item.kind,duration:item.duration_frames};
 });
 return {transitions,captions,id:value.project_id,title:value.title.slice(0,160),revision:value.revision,fps:value.settings.fps,canUndo:Array.isArray(value.history_state?.undo_stack)&&value.history_state.undo_stack.length>0,canRedo:Array.isArray(value.history_state?.redo_stack)&&value.history_state.redo_stack.length>0,tracks};
}
/** Trim and move later clips together, keeping their existing gaps intact. */
export function trimTimeline(project:EditingTimeline,clipId:string,startSeconds:string,endSeconds:string):TimelineCommand[]{
 const track=project.tracks.find(track=>track.clips.some(clip=>clip.id===clipId)),clip=track?.clips.find(clip=>clip.id===clipId);
 if(!track||!clip)throw new Error('Refresh the timeline and select a clip.');
 const start=Number(startSeconds),end=Number(endSeconds),trimIn=Math.round(start*project.fps),trimOut=Math.round(end*project.fps);
 if(!startSeconds.trim()||!endSeconds.trim()||!Number.isFinite(start)||!Number.isFinite(end)||!frame(trimIn)||!frame(trimOut)||trimOut<=trimIn||(clip.sourceFrames!==null&&trimOut>clip.sourceFrames))throw new Error('Choose an end time after the start, within the source clip.');
 if(trimIn===clip.trimIn&&trimOut===clip.trimOut)throw new Error('The timing is unchanged.');
 if((project.transitions??[]).some(t=>(t.from===clipId||t.to===clipId)&&t.duration>=trimOut-trimIn))throw new Error('Shorten or remove this clip’s transition before trimming it this short.');
 const oldEnd=clip.start+clip.duration,delta=trimOut-trimIn-clip.duration;
 if(track.clips.some(other=>other.id!==clip.id&&other.start<oldEnd&&other.start+other.duration>clip.start))throw new Error('This clip overlaps another. Resolve the overlap before trimming here.');
 const commands:TimelineCommand[]=[{id:'trim',type:'clip.trim',payload:{clip_id:clip.id,trim_in_frames:trimIn,trim_out_frames:trimOut}}];
 for(const other of track.clips.filter(other=>other.id!==clip.id&&other.start>=oldEnd))commands.push({id:'move-'+commands.length,type:'clip.move',payload:{clip_id:other.id,track_id:track.id,start_frame:other.start+delta}});
 if(commands.length>32)throw new Error('This track has too many following clips for one trim.');
 return commands;
}

/** The UI accepts seconds into this clip; Cut expects an absolute timeline frame. */
export function splitTimeline(project:EditingTimeline,clipId:string,secondsIntoClip:string):TimelineCommand[]{
 const clips=project.tracks.flatMap(track=>track.clips),clip=clips.find(clip=>clip.id===clipId);
 if(!clip)throw new Error('Refresh the timeline and select a clip.');
 if((project.transitions??[]).some(t=>t.from===clipId||t.to===clipId))throw new Error('Remove this clip’s transition before splitting, then add it to the part you want.');
 const seconds=Number(secondsIntoClip),offset=Math.round(seconds*project.fps);
 if(!secondsIntoClip.trim()||!Number.isFinite(seconds)||!frame(offset)||offset<=0||offset>=clip.duration||!frame(clip.start+offset))throw new Error('Choose a split point inside the clip, after its start and before its end.');
 const used=new Set(clips.map(clip=>clip.id));
 let suffix=0,newId=`split-${project.revision}-${clip.start+offset}`;
 while(used.has(newId))newId=`split-${project.revision}-${clip.start+offset}-${++suffix}`;
 return [{id:'split',type:'clip.split',payload:{clip_id:clip.id,at_frame:clip.start+offset,new_clip_id:newId}}];
}

/** Swap adjacent clips without changing the track's total length or its gap. */
export function moveTimeline(project:EditingTimeline,clipId:string,direction:'earlier'|'later'):TimelineCommand[]{
 const track=project.tracks.find(track=>track.clips.some(clip=>clip.id===clipId));
 if(!track)throw new Error('Refresh the timeline and select a clip.');
 const index=track.clips.findIndex(clip=>clip.id===clipId),target=index+(direction==='earlier'?-1:1);
 if(target<0||target>=track.clips.length)throw new Error('This clip is already at the end of the track.');
 const left=track.clips[Math.min(index,target)],right=track.clips[Math.max(index,target)];
 if((project.transitions??[]).some(t=>[left.id,right.id].includes(t.from)||[left.id,right.id].includes(t.to)))throw new Error('Remove transitions touching these clips before changing their order.');
 const gap=right.start-left.start-left.duration;
 if(gap<0||track.clips.some(clip=>clip.id!==left.id&&clip.id!==right.id&&clip.start<right.start+right.duration&&clip.start+clip.duration>left.start))throw new Error('Resolve overlapping clips before changing their order.');
 const leftStart=left.start+right.duration+gap;
 if(!frame(leftStart))throw new Error('This timeline position is too large.');
 return [
  {id:'move-right-earlier',type:'clip.move',payload:{clip_id:right.id,track_id:track.id,start_frame:left.start}},
  {id:'move-left-later',type:'clip.move',payload:{clip_id:left.id,track_id:track.id,start_frame:leftStart}},
 ];
}

/** Captions use absolute timeline seconds, independent of source trim. */
export function captionTimeline(project:EditingTimeline,text:string,startSeconds:string,endSeconds:string,captionId?:string):TimelineCommand[]{
 const start=Math.round(Number(startSeconds)*project.fps),end=Math.round(Number(endSeconds)*project.fps);
 const duration=Math.max(0,...project.tracks.flatMap(track=>track.clips.map(clip=>clip.start+clip.duration)));
 if(!text.trim()||text.length>2000)throw new Error('Enter caption text, up to 2,000 characters.');
 if(!startSeconds.trim()||!endSeconds.trim()||!frame(start)||!frame(end)||end<=start||end>duration)throw new Error('Choose a caption start and end within the video.');
 if(captionId&&!(project.captions??[]).some(caption=>caption.id===captionId))throw new Error('Refresh the timeline and select the caption again.');
 const used=new Set((project.captions??[]).map(caption=>caption.id));
 let next=`caption-${project.revision}-${start}`,suffix=0;
 while(used.has(next))next=`caption-${project.revision}-${start}-${++suffix}`;
 return [{id:'caption',type:captionId?'caption.edit':'caption.add',payload:{caption_id:captionId??next,text:text.trim(),start_frame:start,end_frame:end}}];
}

export function audioTimeline(project:EditingTimeline,clipId:string,gainText:string,muted:boolean):TimelineCommand[]{
 const clip=project.tracks.flatMap(track=>track.clips).find(clip=>clip.id===clipId);
 if(!clip?.audio?.linked)throw new Error('This clip has no linked audio.');
 const gain=Number(gainText);
 if(!gainText.trim()||!Number.isFinite(gain)||gain< -60||gain>24)throw new Error('Choose a volume between −60 and +24 dB. Zero keeps the original volume.');
 return [{id:'audio',type:'audio.mix',payload:{target:'clip',clip_id:clipId,gain_db:gain,muted}}];
}

export function transitionTimeline(project:EditingTimeline,from:string,kind:keyof typeof TRANSITION_STYLES|'none',seconds:string):TimelineCommand[]{
 const track=project.tracks.find(track=>track.type==='video'&&track.clips.some(clip=>clip.id===from));
 const index=track?.clips.findIndex(clip=>clip.id===from)??-1,left=track?.clips[index],right=track?.clips[index+1];
 if(!left||!right||left.start+left.duration!==right.start)throw new Error('Choose two touching video clips.');
 const payload={from_clip_id:left.id,to_clip_id:right.id};
 if(kind==='none'){
  if(!(project.transitions??[]).some(t=>t.from===left.id&&t.to===right.id))throw new Error('These clips already use a straight cut.');
  return [{id:'transition',type:'transition.remove',payload}];
 }
 const duration=Math.round(Number(seconds)*project.fps);
 if(!Object.hasOwn(TRANSITION_STYLES,kind)||!seconds.trim()||!frame(duration)||duration<1||duration>=Math.min(left.duration,right.duration))throw new Error('Choose a transition shorter than both clips.');
 return [{id:'transition',type:'transition.set',payload:{...payload,kind,duration_frames:duration}}];
}

/** Remove only the timeline reference; sources and other tracks remain intact. */
export function removeTimeline(project:EditingTimeline,clipId:string):TimelineCommand[]{
 const track=project.tracks.find(track=>track.clips.some(clip=>clip.id===clipId)),clip=track?.clips.find(clip=>clip.id===clipId);
 if(!track||!clip)throw new Error('Refresh the timeline and select a clip.');
 if(track.type==='video'&&track.clips.length===1)throw new Error('Keep at least one picture or video in this draft.');
 const end=clip.start+clip.duration;
 if(track.clips.some(other=>other.id!==clipId&&other.start<end&&other.start+other.duration>clip.start))throw new Error('Resolve overlapping clips before removing one here.');
 const commands:TimelineCommand[]=[{id:'remove',type:'clip.remove',payload:{clip_id:clipId}}];
 for(const other of track.clips.filter(other=>other.start>=end))commands.push({id:'close-gap-'+commands.length,type:'clip.move',payload:{clip_id:other.id,track_id:track.id,start_frame:other.start-clip.duration}});
 if(commands.length>32)throw new Error('This track has too many following clips for one removal.');
 return commands;
}

export function addTimelineSources(ids:string[]):TimelineCommand[]{
 if(!ids.length||ids.length>8||new Set(ids).size!==ids.length||ids.some(value=>!id(value)))throw new Error('Choose one to eight different Library items.');
 return ids.map((value,index)=>({id:`add-${index}`,type:'clip.add',payload:{job_id:value}}));
}
