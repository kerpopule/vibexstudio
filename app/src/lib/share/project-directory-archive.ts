import {sha256} from '@noble/hashes/sha2.js';
import type {ExportSink} from '../editing-export-stream';
export interface ArchiveEntry {path:string;chunks:AsyncIterable<Uint8Array>}
export interface ArchiveProgress {bytes:number;totalBytes?:number}
export type ArchiveProgressHandler=(progress:ArchiveProgress)=>void;
const encoder=new TextEncoder(),MAX_FILE=1024**3,MAX_TOTAL=4*MAX_FILE;
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crcUpdate(crc:number,bytes:Uint8Array){for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return crc>>>0;}
function record(size:number,values:[number,number,number][]):Uint8Array{
 const bytes=new Uint8Array(size),view=new DataView(bytes.buffer);
 for(const [offset,width,value] of values){if(width===2)view.setUint16(offset,value,true);else view.setUint32(offset,value,true);}
 return bytes;
}
function pathKey(path:string):string{
 const parts=path.split('/');
 if(path.length>1000||parts.some(p=>!p||p==='.'||p==='..'||/[\\:\x00-\x1f]/.test(p)||/[ .]$/.test(p)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p))||
  !(['project.json','chat.json'].includes(path)||(parts.length>1&&['files','media'].includes(parts[0]))))throw new Error('The archive contains an unsupported project path.');
 return path.normalize('NFKC').toLowerCase().replace(/ß/g,'ss').replace(/ς/g,'σ');
}
/** ZIP_STORED with streaming descriptors; compatible with the controller restorer.
 * The supplied sink owns publication and must discard partial writes on abort.
 * ZIP32 output is capped below 4 GiB; no full-project JSON/base64 buffer is built.
 */
export async function writeProjectDirectoryArchive(entries:AsyncIterable<ArchiveEntry>,sink:ExportSink,onProgress?:ArchiveProgressHandler){
 let offset=0,total=0;const names=new Set<string>();
 const rows:{path:string;bytes:number;sha256:string}[]=[],central:{name:Uint8Array;offset:number;crc:number;size:number}[]=[];
 const write=async(bytes:Uint8Array)=>{if(offset+bytes.length>0xffffffff)throw new Error('This archive exceeds the current 4 GiB output limit.');await sink.write(bytes);offset+=bytes.length;onProgress?.({bytes:offset});};
 async function entry(path:string,chunks:AsyncIterable<Uint8Array>){
  const name=encoder.encode(path),start=offset;
  await write(record(30,[[0,4,0x04034b50],[4,2,20],[6,2,0x808],[26,2,name.length]]));await write(name);
  const hash=sha256.create();let size=0,crc=0xffffffff;
  for await(const chunk of chunks){
   if(!(chunk instanceof Uint8Array)||chunk.byteLength>1024*1024)throw new Error('Archive sources must provide chunks up to 1 MiB.');
   size+=chunk.length;if(size>MAX_FILE)throw new Error('An archive file exceeds 1 GiB.');
   total+=chunk.length;if(total>MAX_TOTAL)throw new Error('The archive exceeds its total size limit.');
   hash.update(chunk);crc=crcUpdate(crc,chunk);await write(chunk);
  }
  crc=(crc^0xffffffff)>>>0;
  await write(record(16,[[0,4,0x08074b50],[4,4,crc],[8,4,size],[12,4,size]]));
  central.push({name,offset:start,crc,size});
  return {path,bytes:size,sha256:Array.from(hash.digest(),b=>b.toString(16).padStart(2,'0')).join('')};
 }
 try{
  for await(const source of entries){
   const key=pathKey(source.path);if(names.has(key)||rows.length>=10000)throw new Error('Too many or conflicting archive files.');
   for(const name of names)if(name.startsWith(key+'/')||key.startsWith(name+'/'))throw new Error('Conflicting archive file and folder names.');
   names.add(key);rows.push(await entry(source.path,source.chunks));
  }
  if(!names.has('project.json'))throw new Error('The project metadata is missing.');
  const manifest=encoder.encode(JSON.stringify({format:'vibex/project-directory-archive',version:1,files:rows}));
  if(manifest.length>4*1024*1024)throw new Error('The archive manifest is too large.');
  await entry('manifest.json',(async function*(){for(let p=0;p<manifest.length;p+=1024*1024)yield manifest.subarray(p,p+1024*1024);})());
  const centralStart=offset;
  for(const item of central){
   await write(record(46,[[0,4,0x02014b50],[4,2,20],[6,2,20],[8,2,0x808],[16,4,item.crc],[20,4,item.size],[24,4,item.size],[28,2,item.name.length],[42,4,item.offset]]));await write(item.name);
  }
  const centralSize=offset-centralStart;
  await write(record(22,[[0,4,0x06054b50],[8,2,central.length],[10,2,central.length],[12,4,centralSize],[16,4,centralStart]]));
  await sink.finish();return {files:rows.length,bytes:rows.reduce((sum,row)=>sum+row.bytes,0),archiveBytes:offset};
 }catch(error){await sink.abort().catch(()=>{});throw error;}
}

export interface ArchiveInput {size:number;slice(start:number,end:number):{arrayBuffer():Promise<ArrayBuffer>}}
/** Read only our stored ZIP subset; callers must stage output until this resolves.
 * A successful return proves every listed file was consumed and checksum-verified.
 */
export async function readProjectDirectoryArchive(input:ArchiveInput,consume:(path:string,chunks:AsyncIterable<Uint8Array>)=>Promise<void>,onProgress?:ArchiveProgressHandler){
 const bad=()=>new Error('This project archive is damaged or uses an unsupported format.');
 if(!Number.isSafeInteger(input.size)||input.size<22||input.size>0xffffffff)throw bad();
 const read=async(start:number,size:number)=>{
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(size)||start<0||size<0||start+size>input.size)throw bad();
  const bytes=new Uint8Array(await input.slice(start,start+size).arrayBuffer());if(bytes.length!==size)throw bad();return bytes;
 };
 const tail=await read(input.size-22,22),end=new DataView(tail.buffer,tail.byteOffset,tail.length);
 if(end.getUint32(0,true)!==0x06054b50||end.getUint16(4,true)||end.getUint16(6,true)||end.getUint16(20,true))throw bad();
 const count=end.getUint16(10,true),centralSize=end.getUint32(12,true),centralStart=end.getUint32(16,true);
 if(!count||count>10001||count!==end.getUint16(8,true)||centralSize>16*1024*1024||centralStart+centralSize!==input.size-22)throw bad();
 const bytes=await read(centralStart,centralSize),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length),decoder=new TextDecoder('utf-8',{fatal:true});
 const entries=new Map<string,{size:number;crc:number;offset:number;start?:number}>();let cursor=0;
 for(let index=0;index<count;index++){
  if(cursor+46>bytes.length||view.getUint32(cursor,true)!==0x02014b50)throw bad();
  const flags=view.getUint16(cursor+8,true),size=view.getUint32(cursor+24,true),length=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),offset=view.getUint32(cursor+42,true),mode=(view.getUint32(cursor+38,true)>>>16)&0xf000;
  if((flags&~0x808)||view.getUint16(cursor+10,true)!==0||view.getUint32(cursor+20,true)!==size||view.getUint16(cursor+34,true)||size>MAX_FILE||offset>=centralStart||![0,0x8000].includes(mode)||cursor+46+length+extra+comment>bytes.length)throw bad();
  const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+length));
  if(entries.has(name))throw bad();entries.set(name,{size,crc:view.getUint32(cursor+16,true),offset});cursor+=46+length+extra+comment;
 }
 if(cursor!==bytes.length)throw bad();
 const ranges:[number,number][]=[];
 for(const [name,item] of entries){
  const local=await read(item.offset,30),header=new DataView(local.buffer,local.byteOffset,local.length);
  if(header.getUint32(0,true)!==0x04034b50||(header.getUint16(6,true)&~0x808)||header.getUint16(8,true)!==0)throw bad();
  const length=header.getUint16(26,true),extra=header.getUint16(28,true);
  if(decoder.decode(await read(item.offset+30,length))!==name)throw bad();
  item.start=item.offset+30+length+extra;if(item.start+item.size>centralStart)throw bad();
  ranges.push([item.offset,item.start+item.size]);
 }
 ranges.sort((a,b)=>a[0]-b[0]);if(ranges.some((range,i)=>i>0&&range[0]<ranges[i-1][1]))throw bad();
 const meta=entries.get('manifest.json');if(!meta||meta.size>4*1024*1024)throw bad();
 const raw=await read(meta.start!,meta.size);
 if(((crcUpdate(0xffffffff,raw)^0xffffffff)>>>0)!==meta.crc)throw bad();
 const manifest=JSON.parse(decoder.decode(raw));
 if(manifest?.format!=='vibex/project-directory-archive'||manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length!==count-1)throw bad();
 const names=new Set<string>();let total=0;
 for(const row of manifest.files){
  if(typeof row?.path!=='string')throw bad();const key=pathKey(row.path),item=entries.get(row.path);
  if(names.has(key)||!item||!Number.isSafeInteger(row.bytes)||row.bytes!==item.size||!/^[a-f0-9]{64}$/.test(row.sha256))throw bad();
  for(const name of names)if(name.startsWith(key+'/')||key.startsWith(name+'/'))throw bad();
  names.add(key);total+=row.bytes;if(total>MAX_TOTAL)throw bad();
 }
 if(!names.has('project.json'))throw bad();
 let processed=0;onProgress?.({bytes:0,totalBytes:total});
 for(const row of manifest.files){
  const item=entries.get(row.path)!;let consumed=false;
  const chunks=(async function*(){
   const hash=sha256.create();let crc=0xffffffff;
   for(let offset=0;offset<item.size;offset+=1024*1024){
    const chunk=await read(item.start!+offset,Math.min(1024*1024,item.size-offset));hash.update(chunk);crc=crcUpdate(crc,chunk);processed+=chunk.length;onProgress?.({bytes:processed,totalBytes:total});yield chunk;
   }
   const digest=Array.from(hash.digest(),b=>b.toString(16).padStart(2,'0')).join('');
   if(digest!==row.sha256||((crc^0xffffffff)>>>0)!==item.crc)throw new Error('A project archive file failed its checksum.');
   consumed=true;
  })();
  await consume(row.path,chunks);if(!consumed)throw new Error('The archive receiver did not verify the complete file.');
 }
 return {files:manifest.files.length,bytes:total};
}
