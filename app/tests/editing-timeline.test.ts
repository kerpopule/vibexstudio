import {expect,it} from 'vitest';
import {parseEditingTimeline,trimTimeline,splitTimeline,moveTimeline,type EditingTimeline} from '@/lib/editing-timeline';
const clip=(id:string,start:number)=>({id,label:id,start,duration:96,trimIn:0,trimOut:96,sourceFrames:240});
const project:EditingTimeline={id:'cut-'+'a'.repeat(32),title:'Draft',revision:0,fps:24,canUndo:false,canRedo:false,tracks:[{id:'video',name:'Video',clips:[clip('first',0),clip('second',120)]}]};
it('trims in frames and moves following clips while preserving the gap',()=>{
 expect(trimTimeline(project,'first','1','3')).toEqual([
  {id:'trim',type:'clip.trim',payload:{clip_id:'first',trim_in_frames:24,trim_out_frames:72}},
  {id:'move-1',type:'clip.move',payload:{clip_id:'second',track_id:'video',start_frame:72}},
 ]);
 expect(project.tracks[0].clips[1].start).toBe(120);
});
it('rejects invalid and unchanged source timing',()=>{
 for(const [start,end] of [['','3'],['NaN','4'],['3','2'],['0','11'],['0','4']])expect(()=>trimTimeline(project,'first',start,end)).toThrow();
});
it('does not guess how overlapping clips should move',()=>{
 expect(()=>trimTimeline({...project,tracks:[{...project.tracks[0],clips:[clip('first',0),clip('second',48)]}]},'first','0','2')).toThrow('overlaps');
});
it('rejects malformed server clips rather than editing an incomplete interpretation',()=>{
 const raw={project_id:project.id,title:'Draft',revision:0,settings:{fps:24},timeline:{tracks:[{id:'video',name:'Video',clips:[{id:'first',label:'First',start_frame:0,duration_frames:96,trim_in_frame:0,trim_out_frame:96}]}]}};
 expect(parseEditingTimeline(raw).tracks[0].clips[0].duration).toBe(96);
 raw.timeline.tracks[0].clips[0].trim_out_frame=97;
 expect(()=>parseEditingTimeline(raw)).toThrow('unreadable clip');
});

it('reads history availability instead of guessing from revision',()=>{
 for(const [history,undo,redo] of [[undefined,false,false],[{undo_stack:['trim'],redo_stack:[]},true,false],[{undo_stack:[],redo_stack:['trim']},false,true],[{undo_stack:[],redo_stack:[]},false,false]] as const){
  const parsed=parseEditingTimeline({project_id:project.id,title:'Draft',revision:12,settings:{fps:24},timeline:{tracks:[]},history_state:history});
  expect([parsed.canUndo,parsed.canRedo]).toEqual([undo,redo]);
 }
});

it('splits relative to a later clip without confusing source trim with timeline position',()=>{
 const changed={...project,tracks:[{...project.tracks[0],clips:[{...clip('second',120),trimIn:24,trimOut:120}]}]};
 expect(splitTimeline(changed,'second','2')[0].payload).toEqual({clip_id:'second',at_frame:168,new_clip_id:'split-0-168'});
});
it('rejects split endpoints and invalid values',()=>{
 for(const value of ['', '0', '4', '5', '-1', 'NaN'])expect(()=>splitTimeline(project,'first',value)).toThrow('inside the clip');
});
it('avoids an existing split ID deterministically',()=>{
 const changed={...project,tracks:[{...project.tracks[0],clips:[...project.tracks[0].clips,clip('split-0-48',300)]}]};
 expect(splitTimeline(changed,'first','2')[0].payload.new_clip_id).toBe('split-0-48-1');
});

it('swaps unequal adjacent clips while preserving the gap and total span',()=>{
 const changed={...project,tracks:[{...project.tracks[0],clips:[{...clip('first',24),duration:48,trimOut:48},clip('second',96)]}]};
 expect(moveTimeline(changed,'second','earlier')).toEqual([
  {id:'move-right-earlier',type:'clip.move',payload:{clip_id:'second',track_id:'video',start_frame:24}},
  {id:'move-left-later',type:'clip.move',payload:{clip_id:'first',track_id:'video',start_frame:144}},
 ]);
 expect(moveTimeline(changed,'first','later')).toEqual(moveTimeline(changed,'second','earlier'));
 expect(changed.tracks[0].clips[0].start).toBe(24);
});
it('refuses edge moves and overlapping sequences',()=>{
 expect(()=>moveTimeline(project,'first','earlier')).toThrow('end of the track');
 expect(()=>moveTimeline(project,'second','later')).toThrow('end of the track');
 expect(()=>moveTimeline({...project,tracks:[{...project.tracks[0],clips:[clip('first',0),clip('second',48)]}]},'first','later')).toThrow('overlapping');
});
