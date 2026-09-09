import {it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {readProjectDirectoryArchive,writeProjectDirectoryArchive} from '../src/lib/share/project-directory-archive';
const chunks=async function*(bytes:Uint8Array){yield bytes;};
it('reports bounded monotonic byte progress without treating it as checksum success',async()=>{
 const buffers:Uint8Array[]=[],written:number[]=[];
 const result=await writeProjectDirectoryArchive((async function*(){
  yield {path:'project.json',chunks:chunks(new TextEncoder().encode('{}'))};
  yield {path:'files/audio.wav',chunks:(async function*(){for(let i=0;i<3;i++)yield new Uint8Array(1024*1024);})()};
 })(),{async write(b){buffers.push(b.slice());},async finish(){},async abort(){}},p=>written.push(p.bytes));
 expect(written.at(-1)).toBe(result.archiveBytes);
 expect(written.every((n,i)=>i===0||n>=written[i-1])).toBe(true);
 const read:{bytes:number;totalBytes?:number}[]=[];
 const input=Buffer.concat(buffers);
 await readProjectDirectoryArchive(new Blob([input]),async(_path,parts)=>{for await(const _ of parts){}},p=>read.push(p));
 expect(read[0]).toEqual({bytes:0,totalBytes:result.bytes});
 expect(read.at(-1)).toEqual({bytes:result.bytes,totalBytes:result.bytes});
 expect(read.every((p,i)=>i===0||p.bytes-read[i-1].bytes<=1024*1024)).toBe(true);
 // Reading the last byte does not imply that its final checksum passed.
 const corrupted=Buffer.from(input);corrupted[2*1024*1024]^=1;
 await expect(readProjectDirectoryArchive(new Blob([corrupted]),async(_path,parts)=>{for await(const _ of parts){}},()=>{})).rejects.toThrow('checksum');
});
it('streams ZIP bytes that Python can restore with exact large-file checksums',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vibex-archive-interop-'));
 const buffers:Uint8Array[]=[],finish=vi.fn(async()=>{}),abort=vi.fn(async()=>{});
 try{
  const receipt=await writeProjectDirectoryArchive((async function*(){
   yield {path:'project.json',chunks:chunks(new TextEncoder().encode('{"id":"game"}'))};
   yield {path:'files/assets/win.mp4',chunks:(async function*(){for(let i=0;i<36;i++)yield new Uint8Array(1024*1024).fill(i);})()};
  })(),{write:async b=>{buffers.push(new Uint8Array(b));},finish,abort});
  expect(receipt.files).toBe(2);expect(receipt.bytes).toBeGreaterThan(36*1024*1024);expect(finish).toHaveBeenCalledOnce();expect(abort).not.toHaveBeenCalled();
  await writeFile(join(root,'backup.vibexdir'),Buffer.concat(buffers));
  execFileSync(process.env.VIBEX_ARCHIVE_TEST_PYTHON||'python3',['-m','media_lab_core.project_archive','restore',join(root,'backup.vibexdir'),join(root,'restored')],{env:{...process.env,PYTHONPATH:fileURLToPath(new URL('../../media-lab/',import.meta.url))}});
  expect(await readFile(join(root,'restored/project.json'),'utf8')).toBe('{"id":"game"}');
  const bytes=await readFile(join(root,'restored/files/assets/win.mp4'));
  expect(bytes.length).toBe(36*1024*1024);for(let i=0;i<36;i++)expect(bytes.subarray(i*1024*1024,(i+1)*1024*1024).every(b=>b===i)).toBe(true);
  execFileSync(process.env.VIBEX_ARCHIVE_TEST_PYTHON||'python3',['-m','media_lab_core.project_archive','pack',join(root,'restored'),join(root,'python.vibexdir')],{env:{...process.env,PYTHONPATH:fileURLToPath(new URL('../../media-lab/',import.meta.url))}});
  const restoredFiles=new Map<string,number>();
  const readReceipt=await readProjectDirectoryArchive(new Blob([await readFile(join(root,'python.vibexdir'))]),async(path,chunks)=>{
   let size=0;for await(const chunk of chunks)size+=chunk.length;restoredFiles.set(path,size);
  });
  expect(readReceipt.files).toBe(2);expect(restoredFiles.get('files/assets/win.mp4')).toBe(bytes.length);

 }finally{await rm(root,{recursive:true,force:true});}
},15000);
it('aborts partial output on path collisions, missing metadata and source failures',async()=>{
 for(const scenario of ['collision','missing','failed']){
  const finish=vi.fn(async()=>{}),abort=vi.fn(async()=>{});
  await expect(writeProjectDirectoryArchive((async function*(){
   yield {path:scenario==='missing'?'files/a.txt':'project.json',chunks:chunks(new Uint8Array([1]))};
   if(scenario==='collision'){yield {path:'files/A.txt',chunks:chunks(new Uint8Array([2]))};yield {path:'files/a.txt',chunks:chunks(new Uint8Array([2]))};}
   if(scenario==='failed')throw new Error('Source changed');
  })(),{write:async()=>{},finish,abort})).rejects.toThrow();
  expect(finish).not.toHaveBeenCalled();expect(abort).toHaveBeenCalledOnce();
 }
});

it('rejects corrupted file bytes and receivers that stop before verification',async()=>{
 const pieces:Uint8Array[]=[];
 await writeProjectDirectoryArchive((async function*(){yield {path:'project.json',chunks:chunks(new TextEncoder().encode('{"id":"p1"}'))};})(),{write:async b=>{pieces.push(new Uint8Array(b));},finish:async()=>{},abort:async()=>{}});
 const good=Buffer.concat(pieces);
 await expect(readProjectDirectoryArchive(new Blob([good]),async()=>{})).rejects.toThrow('complete file');
 for(const mode of ['compressed','symlink','oversized']){
  const invalid=Buffer.from(good),central=invalid.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  if(mode==='compressed')invalid.writeUInt16LE(8,central+10);
  if(mode==='symlink')invalid.writeUInt32LE(0xa1ff0000,central+38);
  if(mode==='oversized')invalid.writeUInt32LE(1024**3+1,central+24);
  const receiver=vi.fn(async()=>{});
  await expect(readProjectDirectoryArchive(new Blob([invalid]),receiver)).rejects.toThrow('unsupported');
  expect(receiver).not.toHaveBeenCalled();
 }
 const bad=Buffer.from(good);bad[30+'project.json'.length]^=1;
 await expect(readProjectDirectoryArchive(new Blob([bad]),async(_path,stream)=>{for await(const _ of stream){}})).rejects.toThrow('checksum');
});
