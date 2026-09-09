import {expect,it} from 'vitest';
import {addTimelineSources} from '@/lib/editing-timeline';
it('preserves media selection order without exposing paths or overrides',()=>{
 expect(addTimelineSources(['video','song'])).toEqual([{id:'add-0',type:'clip.add',payload:{job_id:'video'}},{id:'add-1',type:'clip.add',payload:{job_id:'song'}}]);
});
it('rejects empty, repeated, oversized or invalid selections',()=>{
 for(const ids of [[],['same','same'],['../media'],Array.from({length:9},(_,i)=>String(i))])expect(()=>addTimelineSources(ids)).toThrow('Choose');
});
