import {expect,it,vi} from 'vitest';
import {directorCollections} from '@/lib/director-collections';
const list=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/remote-library',()=>({listSavedCollection:list}));
it('shares bounded record summaries without URLs, samples or raw references',async()=>{
 list.mockResolvedValue(Array.from({length:10},(_,i)=>({id:String(i),title:'Cast',description:'A character',archived:true,beats:[{}],relationshipIssues:[{targetId:'/private/ref.png'}],uri:'private',voiceSample:'secret'})));
 const groups=await directorCollections('https://lab.example');
 expect(groups.map(g=>g.available)).toEqual([10,10,10]);
 expect(groups.every(g=>g.records.length===8)).toBe(true);
 expect(groups[0].records[0]).toMatchObject({archived:true,missingReferences:1,sceneCount:1});
 expect(JSON.stringify(groups)).not.toMatch(/private|secret|targetId/);
});
it('does not silently omit a failed requested collection',async()=>{
 list.mockRejectedValue(new Error('Unavailable'));
 await expect(directorCollections('https://lab.example')).rejects.toThrow('Unavailable');
});
