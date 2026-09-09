import {expect,it} from 'vitest';
import {parseEditingTimeline,audioTimeline} from '@/lib/editing-timeline';
const raw={project_id:'cut-'+'a'.repeat(32),title:'Draft',revision:0,settings:{fps:24},timeline:{tracks:[{id:'video',name:'Video',clips:[{id:'clip',start_frame:0,duration_frames:96,trim_in_frame:0,trim_out_frame:96,audio:{linked:true,muted:false,gain_db:-6}}]}]}};
it('reads saved volume and creates a clip-specific mix without altering the source',()=>{
 const project=parseEditingTimeline(raw);
 expect(project.tracks[0].clips[0].audio).toEqual({linked:true,muted:false,gain:-6});
 expect(audioTimeline(project,'clip','-12',true)).toEqual([{id:'audio',type:'audio.mix',payload:{target:'clip',clip_id:'clip',gain_db:-12,muted:true}}]);
 expect(raw.timeline.tracks[0].clips[0].audio.gain_db).toBe(-6);
});
it('rejects nonnumeric or excessive volume and clips without audio',()=>{
 const project=parseEditingTimeline(raw);
 for(const gain of ['', 'NaN','Infinity','25','-61'])expect(()=>audioTimeline(project,'clip',gain,false)).toThrow('volume');
 expect(()=>audioTimeline(project,'missing','0',false)).toThrow('no linked audio');
 expect(()=>parseEditingTimeline({...raw,timeline:{tracks:[{...raw.timeline.tracks[0],clips:[{...raw.timeline.tracks[0].clips[0],audio:{linked:true,muted:false,gain_db:Infinity}}]}]}})).toThrow('unreadable clip audio');
});
