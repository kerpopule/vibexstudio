import {expect,it} from 'vitest';
import {directorLibrarySelection} from '@/lib/director-library-selection';
it('keeps the latest video, song and model after a batch of images without exceeding 12',()=>{
 const items=[...Array.from({length:20},(_,id)=>({kind:'image',id})),{kind:'video',id:20},{kind:'audio',id:21},{kind:'model',id:22},{kind:'video',id:23}];
 const selected=directorLibrarySelection(items);
 expect(selected.map(item=>item.id)).toEqual([0,1,2,3,4,5,6,7,8,20,21,22]);
 expect(items).toHaveLength(24);
});
it('handles empty and smaller libraries without duplicating entries',()=>{
 expect(directorLibrarySelection([])).toEqual([]);
 const items=[{kind:'video'},{kind:'video'},{kind:'audio'}];
 expect(directorLibrarySelection(items)).toEqual(items);
});

it('finds an older named video beyond the recent window while retaining newest media kinds',()=>{
 const items=[...Array.from({length:40},(_,id)=>({kind:'image',id,prompt:'Fresh landscape'})),{kind:'audio',id:40,prompt:'New soundtrack'},{kind:'model',id:41,prompt:'New mesh'},{kind:'video',id:42,prompt:'Recent video'},{kind:'video',id:43,prompt:'Birthday party montage'}];
 const selected=directorLibrarySelection(items,'Please put my birthday party video on the website');
 expect(selected[0].id).toBe(43);expect(selected.map(item=>item.id)).toEqual(expect.arrayContaining([0,40,41,42,43]));expect(selected).toHaveLength(12);
});
it('ranks fuller title matches ahead of partial matches and handles Unicode case',()=>{
 const items=[{kind:'image',id:1,prompt:'Cafe mural'},{kind:'video',id:2,prompt:'CAFÉ birthday montage'},{kind:'video',id:3,prompt:'Birthday candles'}];
 expect(directorLibrarySelection(items,'Use the café birthday montage')[0].id).toBe(2);
});
it('keeps the recent fallback when title search has no matches or contains only generic terms',()=>{
 const items=Array.from({length:20},(_,id)=>({kind:'image',id,prompt:'Landscape'}));
 expect(directorLibrarySelection(items,'Use my latest image')).toEqual(directorLibrarySelection(items));
 expect(directorLibrarySelection(items,'missing birthday')).toEqual(directorLibrarySelection(items));
});
it('bounds prolific matches without losing other media types or duplicating an entry',()=>{
 const items=[...Array.from({length:30},(_,id)=>({kind:'image',id,title:'Birthday'})),{kind:'video',id:30},{kind:'audio',id:31},{kind:'model',id:32}];
 const selected=directorLibrarySelection(items,'birthday');
 expect(selected.length).toBeLessThanOrEqual(12);expect(new Set(selected.map(item=>item.id)).size).toBe(selected.length);
 expect(selected.map(item=>item.id)).toEqual(expect.arrayContaining([30,31,32]));
});
