import { expect, it } from 'vitest';
import { decodeSpriteExport } from '@/lib/sprite-export';

// Header fixture exercises contract validation, not PNG decoding (server tests
// and browser integration use real Pillow-generated PNG files).
function response() {
  const header = new Uint8Array(24);
  header.set([137,80,78,71,13,10,26,10]);
  const view = new DataView(header.buffer);
  view.setUint32(16,8); view.setUint32(20,8);
  return {version:1,pngBase64:btoa(String.fromCharCode(...header)),metadata:{
    meta:{size:{w:8,h:8},frameOrder:['frame-000.png'],image:'https://private/source.png'},
    frames:{'frame-000.png':{frame:{x:1,y:1,w:4,h:4},spriteSourceSize:{x:2,y:2,w:4,h:4},
      sourceSize:{w:8,h:8},pivot:{x:0.5,y:1},rotated:false,trimmed:true,empty:false,private:'omit'}},
  }};
}
it('keeps alignment metadata but strips source URLs and arbitrary fields',()=>{
  const result=decodeSpriteExport(response());
  expect(result.metadata.meta.image).toBe('atlas.png');
  expect(JSON.stringify(result.metadata)).not.toContain('private');
  expect(result.metadata.frames['frame-000.png']).toMatchObject({spriteSourceSize:{x:2,y:2,w:4,h:4}});
});
it('rejects a claimed size that disagrees with the PNG header',()=>{
  const data=response(); data.metadata.meta.size.w=9;
  expect(()=>decodeSpriteExport(data)).toThrow('invalid sprite');
});
it('rejects out-of-bounds frame rectangles and malformed bytes',()=>{
  const data=response(); data.metadata.frames['frame-000.png'].frame.x=7;
  expect(()=>decodeSpriteExport(data)).toThrow();
  expect(()=>decodeSpriteExport({...response(),pngBase64:'garbage'})).toThrow();
});
it('rejects duplicate animation entries and invalid pivots',()=>{
  const data=response(); data.metadata.meta.frameOrder.push('frame-000.png');
  expect(()=>decodeSpriteExport(data)).toThrow();
  const invalid=response(); invalid.metadata.frames['frame-000.png'].pivot.x=NaN;
  expect(()=>decodeSpriteExport(invalid)).toThrow();
});
