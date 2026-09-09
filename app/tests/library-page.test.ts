import {it,expect} from 'vitest';
import {libraryPage} from '../src/lib/library-page';
it('bounds large catalogs without losing or duplicating items between pages',()=>{
 const items=Array.from({length:5401},(_,id)=>({id}));
 const first=libraryPage(items,0);expect(first.items).toHaveLength(24);
 expect(first).toMatchObject({first:1,last:24,total:5401,pages:226});
 const combined=Array.from({length:first.pages},(_,page)=>libraryPage(items,page).items).flat();
 expect(combined).toEqual(items);
 expect(libraryPage(items,225)).toMatchObject({first:5401,last:5401});
});
it('clamps pages when refreshed results shrink and handles empty results',()=>{
 expect(libraryPage([1,2],20)).toMatchObject({items:[1,2],page:0});
 expect(libraryPage([],NaN)).toMatchObject({items:[],first:0,last:0,page:0,pages:1});
 expect(libraryPage([1],-4).items).toEqual([1]);
});
it('can show a matching item from beyond the first unfiltered page',()=>{
 const items=Array.from({length:5401},(_,id)=>({id}));
 expect(libraryPage(items.filter(item=>item.id===5400),0).items).toEqual([{id:5400}]);
});
