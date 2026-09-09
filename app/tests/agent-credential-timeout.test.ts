import {afterEach,expect,it,vi} from 'vitest';
import {AgentConnectCore,AGENT_CREDENTIAL_TIMEOUT_MS} from '@/lib/agent-connect/core';
afterEach(()=>vi.useRealTimers());
const request={method:'POST',path:'/mcp',headers:{authorization:'Bearer test-token'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'check',arguments:{}}}),remoteAddress:'127.0.0.1'};
function fixture(get:()=>Promise<string|null>){
 const handler=vi.fn(async()=>({ok:true}));
 const core=new AgentConnectCore({metadata:{load:async()=> '[]',save:async()=>{}},credentials:{get,set:async()=>{},remove:async()=>{}},tools:[{name:'check',description:'Test',inputSchema:{type:'object'},handler}]});
 core.agents=[{id:'test',name:'Test',pairedAt:'now'}];return {core,handler};
}
it('bounds stalled vault reads, shares the pending read, and never runs expired calls after unlock',async()=>{
 vi.useFakeTimers();let unlock!:(value:string)=>void;
 const get=vi.fn(()=>new Promise<string>(resolve=>{unlock=resolve;}));const f=fixture(get);
 const first=f.core.route(request),second=f.core.route(request);
 await vi.advanceTimersByTimeAsync(AGENT_CREDENTIAL_TIMEOUT_MS);
 expect((await first).status).toBe(503);expect((await second).status).toBe(503);
 expect(get).toHaveBeenCalledTimes(1);expect(f.handler).not.toHaveBeenCalled();
 unlock('test-token');await vi.advanceTimersByTimeAsync(0);
 expect(f.handler).not.toHaveBeenCalled();
 get.mockResolvedValue('test-token');expect((await f.core.route(request)).status).toBe(200);
 expect(f.handler).toHaveBeenCalledTimes(1);
});
it('returns a sanitized actionable response when the vault rejects access',async()=>{
 const f=fixture(async()=>{throw new Error('private keychain detail');});
 const response=await f.core.route(request);expect(response.status).toBe(503);
 expect(response.body).toContain('No tool was run');expect(response.body).not.toContain('private keychain detail');expect(f.handler).not.toHaveBeenCalled();
});
it('does not authenticate a grant revoked while its credential is being read',async()=>{
 let unlock!:(value:string)=>void;const f=fixture(()=>new Promise(resolve=>{unlock=resolve;}));
 const pending=f.core.route(request);await Promise.resolve();
 await f.core.revokeAgent('test');unlock('test-token');
 expect((await pending).status).toBe(401);expect(f.handler).not.toHaveBeenCalled();
});
