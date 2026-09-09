import {expect,it} from 'vitest';
import {readProjectSprite} from '@/lib/project-sprite';
import type {ProjectFile} from '@/lib/types';
function fixture() {
 const header=new Uint8Array(24);header.set([137,80,78,71,13,10,26,10]);
 const view=new DataView(header.buffer);view.setUint32(16,8);view.setUint32(20,8);
 const image:ProjectFile={path:'assets/unique-sprite-atlas.png',encoding:'base64',content:btoa(String.fromCharCode(...header))};
 const metadata={meta:{app:'VibeXStudio',image:'unique-sprite-atlas.png',size:{w:8,h:8},frameOrder:['frame-000.png']},frames:{'frame-000.png':{frame:{x:1,y:1,w:4,h:4},spriteSourceSize:{x:2,y:2,w:4,h:4},sourceSize:{w:8,h:8},pivot:{x:.5,y:1},rotated:false,trimmed:true,empty:false}}};
 const file:ProjectFile={path:'assets/unique-sprite-atlas.json',encoding:'utf-8',content:JSON.stringify(metadata)};
 return {file,image,metadata};
}
it('resolves only the matching sibling PNG and retains trimmed frame placement',()=>{
 const {file,image}=fixture();
 const result=readProjectSprite(file,[image]);
 expect(result?.image.path).toBe(image.path);
 expect(result?.metadata.frames['frame-000.png']).toMatchObject({spriteSourceSize:{x:2,y:2,w:4,h:4}});
 expect(readProjectSprite(file,[{...image,path:'other/unique-sprite-atlas.png'}])).toBeNull();
});
it('leaves unrelated JSON, missing images, invalid bounds and external references in the editor',()=>{
 const {file,image,metadata}=fixture();
 expect(readProjectSprite({...file,content:'{}'},[image])).toBeNull();
 expect(readProjectSprite(file,[])).toBeNull();
 metadata.frames['frame-000.png'].frame.x=8;
 expect(readProjectSprite({...file,content:JSON.stringify(metadata)},[image])).toBeNull();
 for(const name of ['../unique-sprite-atlas.png','https://example.com/x.png','/x.png']) {
  metadata.meta.image=name;
  expect(readProjectSprite({...file,content:JSON.stringify(metadata)},[image])).toBeNull();
 }
});
