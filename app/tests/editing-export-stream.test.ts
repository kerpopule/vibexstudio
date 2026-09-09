import {expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {streamEditingExport} from '@/lib/editing-export-stream';
const bytes=new Uint8Array([1,2,3,4]),receipt={bytes:4,sha256:createHash('sha256').update(bytes).digest('hex')};
function response(data=bytes){return new Response(new ReadableStream({start(c){c.enqueue(data.subarray(0,2));c.enqueue(data.subarray(2));c.close();}}),{headers:{'Content-Type':'video/mp4','X-Content-SHA256':receipt.sha256}});}
function sink(){return {write:vi.fn(async()=>{}),finish:vi.fn(async()=>{}),abort:vi.fn(async()=>{})};}
it('writes incrementally and commits only verified bytes',async()=>{
 const target=sink();await streamEditingExport(response(),receipt,target);
 expect(target.write).toHaveBeenCalledTimes(2);expect(target.finish).toHaveBeenCalledOnce();expect(target.abort).not.toHaveBeenCalled();
});
it.each([new Uint8Array([1,2]),new Uint8Array([1,2,3,5]),new Uint8Array([1,2,3,4,5])])('aborts truncated, changed or oversized downloads',async data=>{
 const target=sink();await expect(streamEditingExport(response(data),receipt,target)).rejects.toThrow();
 expect(target.finish).not.toHaveBeenCalled();expect(target.abort).toHaveBeenCalledOnce();
});
it('aborts disk failure and does not commit',async()=>{
 const target=sink();target.write.mockRejectedValueOnce(new Error('Disk full'));
 await expect(streamEditingExport(response(),receipt,target)).rejects.toThrow('Disk full');
 expect(target.finish).not.toHaveBeenCalled();expect(target.abort).toHaveBeenCalledOnce();
});
