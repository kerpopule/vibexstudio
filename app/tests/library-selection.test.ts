import {expect,it} from 'vitest';
import {selectLibrarySources} from '@/lib/library-selection';
const make=(id:number,title='Generic clip',kind='video',source='server')=>({id,offer:{title,kind,source,createdAt:id}});
it('retains the latest five when the request only asks for latest media',()=>{
 const rows=Array.from({length:10},(_,i)=>make(i));
 expect(selectLibrarySources(rows,'Use my latest video').map(row=>row.id)).toEqual([9,8,7,6,5]);
});
it('includes named older creations without losing the newest assets',()=>{
 const rows=[make(1,'Forest waterfall'),make(2,'Forest clearing'),...Array.from({length:8},(_,i)=>make(i+3))];
 expect(selectLibrarySources(rows,'Put my forest waterfall video on the website').map(row=>row.id)).toEqual([10,9,8,2,1]);
 expect(rows[0].id).toBe(1);
});
it('keeps the bound separately for each kind and source',()=>{
 const rows=['server','device'].flatMap(source=>['image','audio'].flatMap(kind=>Array.from({length:8},(_,i)=>make(i,'Forest',kind,source))));
 const chosen=selectLibrarySources(rows,'Use forest');
 expect(chosen).toHaveLength(20);
 for(const source of ['server','device'])for(const kind of ['image','audio'])expect(chosen.filter(row=>row.offer.source===source&&row.offer.kind===kind)).toHaveLength(5);
});
it('matches case-insensitive complete Unicode words and avoids substring collisions',()=>{
 const rows=[make(1,'CAFÉ at sunset'),make(2,'Caféteria'),...Array.from({length:6},(_,i)=>make(i+3))];
 const chosen=selectLibrarySources(rows,'Use the café image');
 expect(chosen.some(row=>row.id===1)).toBe(true);expect(chosen.some(row=>row.id===2)).toBe(false);
});
