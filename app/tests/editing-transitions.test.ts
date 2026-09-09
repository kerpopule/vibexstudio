import {expect,it} from 'vitest';
import {parseEditingTimeline,transitionTimeline,trimTimeline,splitTimeline,moveTimeline} from '@/lib/editing-timeline';
const raw={project_id:'cut-'+'a'.repeat(32),title:'Draft',revision:0,settings:{fps:24},timeline:{tracks:[{id:'v',type:'video',name:'Video',clips:['first','second'].map((id,i)=>({id,start_frame:i*96,duration_frames:96,trim_in_frame:0,trim_out_frame:96}))}],transitions:[{from_clip_id:'first',to_clip_id:'second',kind:'dissolve',duration_frames:12}]}};
it('loads and updates transitions with frame-accurate durations',()=>{
 const p=parseEditingTimeline(raw);
 expect(p.transitions).toEqual([{from:'first',to:'second',kind:'dissolve',duration:12}]);
 expect(transitionTimeline(p,'first','wipeleft','0.75')[0]).toEqual({id:'transition',type:'transition.set',payload:{from_clip_id:'first',to_clip_id:'second',kind:'wipeleft',duration_frames:18}});
 expect(transitionTimeline(p,'first','none','')[0].type).toBe('transition.remove');
});
it('rejects invalid lengths and missing neighboring video clips',()=>{
 const p=parseEditingTimeline(raw);
 for(const seconds of ['', 'NaN','-1','0','4'])expect(()=>transitionTimeline(p,'first','dissolve',seconds)).toThrow('shorter');
 expect(()=>transitionTimeline(p,'second','dissolve','0.5')).toThrow('touching');
 p.tracks[0].clips[1].start++;expect(()=>transitionTimeline(p,'first','dissolve','0.5')).toThrow('touching');
});

it('prevents clip edits that would leave unusable transitions',()=>{
 const p=parseEditingTimeline(raw);
 expect(()=>trimTimeline(p,'first','0','0.25')).toThrow('transition');
 expect(()=>splitTimeline(p,'first','2')).toThrow('transition');
 expect(()=>moveTimeline(p,'first','later')).toThrow('transitions');
 expect(trimTimeline(p,'first','0','3')).toHaveLength(2);
});
