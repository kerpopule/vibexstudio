import {expect,it} from 'vitest';
import {captionTimeline,parseEditingTimeline} from '@/lib/editing-timeline';
const raw={project_id:'cut-'+'a'.repeat(32),title:'Draft',revision:4,settings:{fps:24},timeline:{tracks:[{id:'v',name:'Video',clips:[{id:'c',start_frame:0,duration_frames:192,trim_in_frame:0,trim_out_frame:192}]}],captions:{items:[{id:'caption-4-24',text:'Old',start_frame:24,end_frame:48}]}}};
it('adds and edits frame-accurate captions without overwriting an existing identity',()=>{
 const project=parseEditingTimeline(raw);
 expect(project.captions).toEqual([{id:'caption-4-24',text:'Old',start:24,end:48}]);
 expect(captionTimeline(project,' Hello ','1','2.5')[0]).toEqual({id:'caption',type:'caption.add',payload:{caption_id:'caption-4-24-1',text:'Hello',start_frame:24,end_frame:60}});
 expect(captionTimeline(project,'Changed','0','3','caption-4-24')[0].type).toBe('caption.edit');
 expect(raw.timeline.captions.items[0].text).toBe('Old');
});
it('rejects invalid, empty and out-of-video caption ranges before submission',()=>{
 const project=parseEditingTimeline(raw);
 for(const [start,end] of [['','2'],['-1','2'],['2','2'],['0','9'],['NaN','3']])expect(()=>captionTimeline(project,'Text',start,end)).toThrow();
 expect(()=>captionTimeline(project,' ','0','2')).toThrow('text');
 expect(()=>captionTimeline(project,'Text','0','2','missing')).toThrow('Refresh');
});
it('rejects corrupt caption data rather than silently hiding it',()=>{
 expect(()=>parseEditingTimeline({...raw,timeline:{...raw.timeline,captions:{items:[{id:'bad',text:'Text',start_frame:30,end_frame:20}]}}})).toThrow('unreadable caption');
});
