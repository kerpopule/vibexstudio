import {expect,it,vi} from 'vitest';
import {createMediaConnectTools} from '@/lib/agent-connect/media-tools';
import type {RemoteLibraryAsset} from '@/lib/library-core';
const agent={id:'test-agent',name:'Test',pairedAt:'now',mediaRead:true};
const asset=(id:string,createdAt:number,title:string,kind:RemoteLibraryAsset['kind']='video'):RemoteLibraryAsset=>({id,createdAt,title,kind,prompt:'',fileName:`${id}.mp4`,mimeType:'video/mp4',bytes:10,providerLabel:'Test',serverUrl:'https://private.test'});
it('finds an older named asset before applying the 100-result cap',async()=>{
 const rows=[asset('old',1,'Forest waterfall'),...Array.from({length:150},(_,i)=>asset(`new-${i}`,i+2,'Other clip'))];
 const result=await createMediaConnectTools(async()=>rows)[0].handler({query:'FOREST waterfall',kind:'video'},agent) as any;
 expect(result.assets.map((row:any)=>row.id)).toEqual(['old']);expect(result.total).toBe(1);expect(result.truncated).toBe(false);
 expect(JSON.stringify(result)).not.toContain('https://private.test');
});
it('combines kind and all search terms across title and prompt, newest first',async()=>{
 const rows=[asset('old',1,'Forest'),{...asset('new',2,'Forest'),prompt:'Waterfall at sunrise'},asset('image',3,'Forest waterfall','image')];
 const result=await createMediaConnectTools(async()=>rows)[0].handler({query:'forest waterfall',kind:'video'},agent) as any;
 expect(result.assets.map((row:any)=>row.id)).toEqual(['new']);
 const recent=await createMediaConnectTools(async()=>rows)[0].handler({kind:'video'},agent) as any;
 expect(recent.assets.map((row:any)=>row.id)).toEqual(['new','old']);
});
it.each([{query:42},{query:' '},{query:'x'.repeat(201)},{kind:'code'}])('rejects invalid filters before touching the library: %j',async args=>{
 const list=vi.fn(async()=>[]);
 await expect(createMediaConnectTools(list)[0].handler(args,agent)).rejects.toThrow();expect(list).not.toHaveBeenCalled();
});
it('reaches every matching asset across tied timestamps without duplicates',async()=>{
 const rows=Array.from({length:251},(_,i)=>asset(`clip-${String(i).padStart(3,'0')}`,100,'Forest clip')).reverse();
 const list=createMediaConnectTools(async()=>[...rows,asset('other',200,'City clip')])[0];
 const ids:string[]=[];let after:unknown=undefined;
 do {
  const result=await list.handler({query:'forest',kind:'video',...(after?{after}: {})},agent) as any;
  expect(result.assets.length).toBeLessThanOrEqual(100);
  expect(result.total).toBe(251);
  ids.push(...result.assets.map((row:any)=>row.id));after=result.nextCursor;
 } while(after);
 expect(ids).toEqual([...rows].reverse().map(row=>row.id));
 expect(new Set(ids).size).toBe(251);
});
it('does not shift the next page when newer creations arrive or the boundary item is removed',async()=>{
 let rows=Array.from({length:105},(_,i)=>asset(`clip-${i}`,i,'Clip'));
 const list=createMediaConnectTools(async()=>rows)[0];
 const first=await list.handler({},agent) as any;
 rows=[asset('new',999,'New'),...rows.filter(row=>row.id!==first.nextCursor.id)];
 const second=await list.handler({after:first.nextCursor},agent) as any;
 expect(second.assets.map((row:any)=>row.id)).toEqual(['clip-4','clip-3','clip-2','clip-1','clip-0']);
 expect(second.nextCursor).toBeNull();expect(second.truncated).toBe(false);
});
it.each([null,[],{}, {createdAt:NaN,id:'a'},{createdAt:'1',id:'a'},{createdAt:1,id:''},{createdAt:1,id:'x'.repeat(201)},{createdAt:1,id:'a',extra:true}])('rejects malformed pagination before loading media: %j',async after=>{
 const list=vi.fn(async()=>[]);
 await expect(createMediaConnectTools(list)[0].handler({after},agent)).rejects.toThrow(/nextCursor/);
 expect(list).not.toHaveBeenCalled();
});
it('browses exact folder boundaries with optional direct-child filtering',async()=>{
 const rows=[
  {...asset('direct',1,'Song'),folder:'Videos/Music Videos'},
  {...asset('nested',2,'Song'),folder:'Videos/Music Videos/Drafts'},
  {...asset('sibling',3,'Song'),folder:'Videos/Music Videos Old'},
  {...asset('wrong-case',4,'Song'),folder:'Videos/music videos'},
  asset('root',5,'Song'),
 ];
 const tool=createMediaConnectTools(async()=>rows)[0];
 const ids=async(args:Record<string,unknown>)=>((await tool.handler(args,agent)) as any).assets.map((row:any)=>row.id);
 expect(await ids({folder:'Videos/Music Videos'})).toEqual(['nested','direct']);
 expect(await ids({folder:'Videos/Music Videos',includeSubfolders:false})).toEqual(['direct']);
 expect(await ids({folder:'',includeSubfolders:false})).toEqual(['root']);
 expect(await ids({folder:''})).toHaveLength(5);
 expect(await ids({folder:'Videos/Music Videos',query:'song',kind:'image'})).toEqual([]);
});
it.each([{folder:42},{folder:'/Videos'},{folder:'Videos/../Images'},{folder:'Videos//Music'},{folder:'Videos\\Music'},{folder:'Videos\u0000'},{folder:'x'.repeat(1025)},{includeSubfolders:false},{folder:'Videos',includeSubfolders:'false'}])('rejects invalid folder options before loading assets: %j',async args=>{
 const list=vi.fn(async()=>[]);
 await expect(createMediaConnectTools(list)[0].handler(args,agent)).rejects.toThrow();
 expect(list).not.toHaveBeenCalled();
});
