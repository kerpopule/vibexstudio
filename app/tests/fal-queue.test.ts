import {afterEach,expect,it,vi} from 'vitest';
import {falQueueUrl,falModelUrl,fetchFalQueue} from '../src/lib/ai/fal-queue';
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
it.each(['http://queue.fal.run/job','https://queue.fal.run.evil.example/job','https://evil.example/job','https://secret@queue.fal.run/job','https://queue.fal.run:8443/job','file:///private/key','https://queue.fal.run/job#secret'])('refuses credentials to unexpected destination %s',async url=>{
 const fetcher=vi.spyOn(globalThis,'fetch');
 await expect(fetchFalQueue(url,'test-key')).rejects.toThrow();
 expect(fetcher).not.toHaveBeenCalled();
});
it('permits documented queue addresses and disables cookies and redirects',async()=>{
 const url='https://queue.fal.run/fal-ai/flux/schnell/requests/request-1/status';
 expect(falQueueUrl(url)).toBe(url);
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'));
 await fetchFalQueue(url,'test-key');
 expect(fetcher).toHaveBeenCalledWith(url,expect.objectContaining({method:'GET',redirect:'error',credentials:'omit',headers:expect.objectContaining({Authorization:'Key test-key'})}));
});
it('rejects model query injection and traversal before submission',()=>{
 for(const model of ['fal-ai/../other','fal-ai/./other','fal-ai/model?webhook=elsewhere','//evil.example/model','fal-ai/model#x','fal-ai/%2e%2e/model'])expect(()=>falModelUrl(model)).toThrow();
 expect(falModelUrl('fal-ai/kling-video/v2.1/standard/text-to-video')).toBe('https://queue.fal.run/fal-ai/kling-video/v2.1/standard/text-to-video');
});
it('does not repeat an ambiguous paid submission or expose transport diagnostics',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('test-key internal diagnostic'));
 await expect(fetchFalQueue(falModelUrl('fal-ai/flux/dev'),'test-key',{prompt:'Test'})).rejects.toThrow('may still run');
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('bounds an unresponsive request and preserves unknown acceptance',async()=>{
 vi.useFakeTimers();
 vi.spyOn(globalThis,'fetch').mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')))));
 const operation=fetchFalQueue(falModelUrl('fal-ai/flux/dev'),'test-key',{prompt:'Test'});
 const assertion=expect(operation).rejects.toThrow('may still run');
 await vi.advanceTimersByTimeAsync(30_000);await assertion;
});
it('times out a body that stalls after successful response headers',async()=>{
 vi.useFakeTimers();
 const cancel=vi.fn();
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel})));
 const operation=fetchFalQueue(falModelUrl('fal-ai/flux/dev'),'test-key');
 const assertion=expect(operation).rejects.toThrow('does not mean the generation stopped');
 await vi.advanceTimersByTimeAsync(30_000);await assertion;expect(cancel).toHaveBeenCalledOnce();
});
it('rejects an oversized streaming response even without content-length',async()=>{
 const cancel=vi.fn();
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(2*1024*1024+1));},cancel})));
 await expect(fetchFalQueue(falModelUrl('fal-ai/flux/dev'),'test-key')).rejects.toThrow('Could not read');
 expect(cancel).toHaveBeenCalledOnce();
});
it('decodes split UTF-8 and preserves HTTP errors for the caller',async()=>{
 const bytes=new TextEncoder().encode('{"error":"🌎"}');
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}}),{status:422}));
 const response=await fetchFalQueue(falModelUrl('fal-ai/flux/dev'),'test-key');
 expect(response.ok).toBe(false);expect(response.status).toBe(422);expect(await response.text()).toBe('{"error":"🌎"}');
});
