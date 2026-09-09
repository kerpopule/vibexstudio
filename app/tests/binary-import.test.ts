import {expect,it} from 'vitest';
import {assertIdenticalImportBytes,assertIdenticalImportStream,binaryImportBase64,conflictingImportPath} from '../src/lib/storage/binary-import';
it('rejects a truncated read even when every returned byte matches',()=>{
 const source=new Uint8Array([1,2,3]);
 expect(()=>assertIdenticalImportBytes(new Uint8Array([]),source)).toThrow(/byte count/);
 expect(()=>assertIdenticalImportBytes(new Uint8Array([1,2]),source)).toThrow(/byte count/);
 expect(()=>assertIdenticalImportBytes(new Uint8Array([1,2,3,4]),source)).toThrow(/byte count/);
 expect(()=>assertIdenticalImportBytes(new Uint8Array([1,2,4]),source)).toThrow(/different content/);
 expect(()=>assertIdenticalImportBytes(source.slice(),source)).not.toThrow();
});
it('encodes binary data correctly across chunk boundaries',()=>{
 for(const size of [1,2,3,24575,24576,24577,49153]){
  const bytes=Uint8Array.from({length:size},(_,i)=>i%251);
  expect(binaryImportBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
 }
});
it('detects path collisions across case, Unicode normalization and file/folder boundaries',()=>{
 for(const path of ['assets/É.png','assets/e\u0301.png','assets/é.png/child','assets'])expect(conflictingImportPath(path,'assets/é.png')).toBe(true);
 expect(conflictingImportPath('assets/é.png-copy','assets/é.png')).toBe(false);
});

it('compares bounded reads, tolerates partial chunks and always closes the reader',()=>{
 const bytes=Uint8Array.from({length:150000},(_,i)=>i%251);
 for(const limit of [1000,65536]){
  let offset=0,closed=false;
  assertIdenticalImportStream({readBytes:length=>{expect(length).toBeLessThanOrEqual(65536);const part=bytes.subarray(offset,offset+Math.min(length,limit));offset+=part.length;return part;},close:()=>{closed=true;}},bytes);
  expect(closed).toBe(true);expect(offset).toBe(bytes.length);
 }
 for(const content of [bytes.subarray(0,100000),new Uint8Array(150000),new Uint8Array(150001)]){
  let offset=0,closed=false;
  expect(()=>assertIdenticalImportStream({readBytes:length=>{const chunk=content.subarray(offset,offset+length);offset+=chunk.length;return chunk;},close:()=>{closed=true;}},bytes)).toThrow();
  expect(closed).toBe(true);
 }
});
