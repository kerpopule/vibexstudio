import {expect,it} from 'vitest';
import {removeTimeline,type EditingTimeline} from '@/lib/editing-timeline';
const clip=(id:string,start:number)=>({id,label:id,start,duration:48,trimIn:0,trimOut:48,sourceFrames:96});
const project:EditingTimeline={id:'cut-'+'a'.repeat(32),title:'Draft',revision:0,fps:24,canUndo:false,canRedo:false,tracks:[{id:'v',type:'video',name:'Video',clips:[clip('first',0),clip('middle',48),clip('last',96)]},{id:'a',type:'music',name:'Music',clips:[clip('song',0)]}]};
it('removes a reference and closes its gap without moving another track',()=>{
 expect(removeTimeline(project,'middle')).toEqual([{id:'remove',type:'clip.remove',payload:{clip_id:'middle'}},{id:'close-gap-1',type:'clip.move',payload:{clip_id:'last',track_id:'v',start_frame:48}}]);
 expect(project.tracks[0].clips).toHaveLength(3);
 expect(removeTimeline(project,'song')).toEqual([{id:'remove',type:'clip.remove',payload:{clip_id:'song'}}]);
});
it('protects the final visual clip and refuses ambiguous overlaps',()=>{
 expect(()=>removeTimeline({...project,tracks:[{...project.tracks[0],clips:[clip('first',0)]}]},'first')).toThrow('at least one');
 expect(()=>removeTimeline({...project,tracks:[{...project.tracks[0],clips:[clip('first',0),clip('middle',24)]}]},'first')).toThrow('overlapping');
});
