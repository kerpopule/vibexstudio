import {afterEach,expect,it,vi} from 'vitest';
import {AgentConnectCore,AGENT_CREDENTIAL_TIMEOUT_MS} from '@/lib/agent-connect/core';

afterEach(()=>vi.useRealTimers());
const request={method:'POST',path:'/mcp',headers:{authorization:'Bearer test-token'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'check',arguments:{}}}),remoteAddress:'127.0.0.1'};
function fixture(remove:()=>Promise<void>){
 let saved=JSON.stringify([{id:'test',name:'Test',pairedAt:'now'}]);
 const handler=vi.fn(async()=>({ok:true}));
 const metadata={load:async()=>saved,save:vi.fn(async(value:string)=>{saved=value;})};
 const options={metadata,credentials:{get:async()=> 'test-token',set:async()=>{},remove},tools:[{name:'check',description:'Test',inputSchema:{type:'object'},handler}]};
 return {core:new AgentConnectCore(options),restart:()=>new AgentConnectCore(options),metadata,handler};
}
it('keeps a saved unlink revoked after vault deletion fails, including after restart',async()=>{
 const f=fixture(async()=>{throw new Error('private vault details');});await f.core.load();
 expect(await f.core.revokeAgent('test')).toEqual({credentialCleanupPending:true});
 expect(f.core.agents).toEqual([]);expect((await f.core.route(request)).status).toBe(401);
 const restarted=f.restart();await restarted.load();expect((await restarted.route(request)).status).toBe(401);
 expect(f.handler).not.toHaveBeenCalled();
});
it('bounds vault cleanup without restoring access and safely allows late cleanup',async()=>{
 vi.useFakeTimers();let finish!:()=>void;
 const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));await f.core.load();
 const unlink=f.core.revokeAgent('test');await vi.advanceTimersByTimeAsync(AGENT_CREDENTIAL_TIMEOUT_MS);
 expect(await unlink).toEqual({credentialCleanupPending:true});
 expect((await f.core.route(request)).status).toBe(401);
 finish();await vi.advanceTimersByTimeAsync(0);expect(f.core.agents).toEqual([]);
});
it('reports a failed metadata save without deleting credentials or claiming success',async()=>{
 const remove=vi.fn(async()=>{});const f=fixture(remove);await f.core.load();
 f.metadata.save.mockRejectedValueOnce(new Error('private storage details'));
 await expect(f.core.revokeAgent('test')).rejects.toThrow('agent is still linked');
 expect(remove).not.toHaveBeenCalled();expect(f.core.agents).toHaveLength(1);
 expect((await f.core.route(request)).status).toBe(200);
});
it('does not run an authenticated tool if unlink happens while its metadata write is waiting',async()=>{
 let finish!:()=>void;const f=fixture(async()=>{});await f.core.load();
 f.metadata.save.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const call=f.core.route(request);
 await vi.waitFor(()=>expect(f.metadata.save).toHaveBeenCalledTimes(1));
 const unlink=f.core.revokeAgent('test');finish();
 expect((await call).status).toBe(401);await unlink;
 const restarted=f.restart();await restarted.load();expect(restarted.agents).toEqual([]);
 expect(f.handler).not.toHaveBeenCalled();
});
