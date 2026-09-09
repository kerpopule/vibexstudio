import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({data:new Map<string,string>(),set:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage',()=>({default:{getItem:async(k:string)=>f.data.get(k)??null,setItem:(k:string,v:string)=>f.set(k,v),getAllKeys:async()=>[...f.data.keys()],multiGet:async(keys:string[])=>keys.map(k=>[k,f.data.get(k)]),removeItem:async(k:string)=>{f.data.delete(k);}}}));
import {acceptFalRequest,listFalRequests} from '../src/lib/ai/fal-recovery';
const input={id:'request-1',providerId:'provider-1',providerLabel:'fal',kind:'image' as const,prompt:'Test',model:'fal-ai/flux/dev'};
const accepted={status_url:'https://queue.fal.run/fal-ai/flux/requests/id/status',response_url:'https://queue.fal.run/fal-ai/flux/requests/id'};
beforeEach(()=>{vi.restoreAllMocks();f.data.clear();f.set.mockReset().mockImplementation(async(k:string,v:string)=>{f.data.set(k,v);});});
it('persists acceptance across reload and never repeats the paid POST',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(accepted)));
 await acceptFalRequest(input,'test-key');vi.resetModules();
 const resumed=await import('../src/lib/ai/fal-recovery');
 expect(await resumed.acceptFalRequest(input,'test-key')).toEqual({statusUrl:accepted.status_url,responseUrl:accepted.response_url});
 expect(fetcher).toHaveBeenCalledTimes(1);expect(JSON.stringify([...f.data.values()])).not.toContain('test-key');
 expect(await resumed.listFalRequests()).toHaveLength(1);
});
it('refuses to resubmit unknown acceptance after a lost response',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('lost'));
 await expect(acceptFalRequest(input,'test-key')).rejects.toThrow('may still run');
 await expect(acceptFalRequest(input,'test-key')).rejects.toThrow('unknown');
 expect(fetcher).toHaveBeenCalledTimes(1);
 expect((await listFalRequests())[0].phase).toBe('submitting');
});
it('does not submit when durable storage fails',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch');f.set.mockRejectedValueOnce(new Error('full'));
 await expect(acceptFalRequest(input,'test-key')).rejects.toThrow('full');expect(fetcher).not.toHaveBeenCalled();
});
it('keeps acceptance unknown if saving the returned identity fails',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(accepted)));
 f.set.mockImplementationOnce(async(k:string,v:string)=>{f.data.set(k,v);}).mockRejectedValueOnce(new Error('full'));
 await expect(acceptFalRequest(input,'test-key')).rejects.toThrow('full');
 await expect(acceptFalRequest(input,'test-key')).rejects.toThrow('unknown');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('refuses changed provider, prompt, or model without a new request',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(accepted)));
 await acceptFalRequest(input,'test-key');
 for(const change of [{providerId:'other'},{prompt:'different'},{model:'fal-ai/other'},{projectId:'another-project'}])await expect(acceptFalRequest({...input,...change},'test-key')).rejects.toThrow('different');
});
it('serializes duplicate requests and validates both returned URLs before polling',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(accepted)));
 await Promise.all([acceptFalRequest(input,'test-key'),acceptFalRequest(input,'test-key')]);expect(fetcher).toHaveBeenCalledTimes(1);
 fetcher.mockResolvedValueOnce(new Response(JSON.stringify({...accepted,response_url:'https://elsewhere.example/result'})));
 await expect(acceptFalRequest({...input,id:'request-2'},'test-key')).rejects.toThrow('unexpected');
 expect((await listFalRequests()).find(row=>row.id==='request-2')?.phase).toBe('submitting');
});
it('refuses a saved record whose identity differs from its storage key',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(accepted)));
 await acceptFalRequest(input,'test-key');
 const name=[...f.data.keys()][0];f.data.set(name,JSON.stringify({...JSON.parse(f.data.get(name)!),id:'other'}));
 await expect(acceptFalRequest(input,'test-key')).rejects.toThrow('different');
});

it('persists song settings and refuses changed length or vocals when resuming',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(accepted)));
 const song={...input,kind:'audio' as const,model:'fal-ai/ace-step/prompt-to-audio',songOptions:{duration:30 as const,instrumental:true}};
 await acceptFalRequest(song,'test-key');
 expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({prompt:'Test',duration:30,instrumental:true});
 expect((await listFalRequests())[0].songOptions).toEqual(song.songOptions);
 await acceptFalRequest({...song,songOptions:{instrumental:true,duration:30}},'test-key');
 for(const songOptions of [{duration:60 as const,instrumental:true},{duration:30 as const,instrumental:false}])
  await expect(acceptFalRequest({...song,songOptions},'test-key')).rejects.toThrow('different generation settings');
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects invalid or non-audio song settings before persistence and submission',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch');
 await expect(acceptFalRequest({...input,songOptions:{duration:30,instrumental:true}},'test-key')).rejects.toThrow('audio requests only');
 await expect(acceptFalRequest({...input,kind:'audio',songOptions:{duration:900,instrumental:true} as any},'test-key')).rejects.toThrow('song length');
 expect(fetcher).not.toHaveBeenCalled();expect(f.set).not.toHaveBeenCalled();
});
