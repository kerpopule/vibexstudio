import {afterEach,expect,it,vi} from 'vitest';
import {AgentConnectCore,AGENT_CREDENTIAL_TIMEOUT_MS} from '@/lib/agent-connect/core';
afterEach(()=>vi.useRealTimers());
const request=(body:unknown)=>({method:'POST',path:'/pair',headers:{},body:JSON.stringify(body),remoteAddress:'127.0.0.1'});
function fixture(set:(id:string,token:string)=>Promise<void>){
 let sequence=0;
 const remove=vi.fn(async()=>{}),save=vi.fn(async()=>{});
 const core=new AgentConnectCore({randomHex:()=>String(++sequence),credentials:{get:async()=>null,set,remove},metadata:{load:async()=> '[]',save},tools:[]});
 return {core,remove,save};
}
it('rejects immediate retries after approval and while a credential is being saved',async()=>{
 let finish!:()=>void;
 const set=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));const f=fixture(set);
 const code=f.core.issueTicket().code;
 const pairing=f.core.route(request({code,agentName:'Hermes'}));
 void f.core.resolveApproval(true);
 expect((await f.core.route(request({code,agentName:'Retry'}))).status).toBe(429);
 await vi.waitFor(()=>expect(set).toHaveBeenCalledTimes(1));
 expect((await f.core.route(request({code,agentName:'Retry'}))).status).toBe(410);
 expect(f.core.pendingApproval).toBeNull();finish();
 expect((await pairing).status).toBe(200);expect(f.core.agents).toHaveLength(1);
});
it('returns a sanitized save failure and requires a fresh invite with fresh approval',async()=>{
 const set=vi.fn(async()=>{}).mockRejectedValueOnce(new Error('private vault data'));const f=fixture(set);
 const code=f.core.issueTicket().code;const first=f.core.route(request({code}));await f.core.resolveApproval(true);
 const result=await first;expect(result.status).toBe(503);expect(result.body).not.toContain('private vault data');
 expect(f.core.agents).toEqual([]);expect((await f.core.route(request({code}))).status).toBe(410);
 const fresh=f.core.issueTicket().code;expect(fresh).not.toBe(code);
 const second=f.core.route(request({code:fresh}));expect(f.core.pendingApproval).not.toBeNull();
 await f.core.resolveApproval(true);expect((await second).status).toBe(200);
});
it('times out a stalled vault save without creating a grant when the OS later finishes',async()=>{
 vi.useFakeTimers();let finish!:()=>void;const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));
 const code=f.core.issueTicket().code;const pending=f.core.route(request({code}));await f.core.resolveApproval(true);
 await vi.advanceTimersByTimeAsync(AGENT_CREDENTIAL_TIMEOUT_MS);
 expect((await pending).status).toBe(503);expect(f.core.agents).toEqual([]);expect(f.remove).not.toHaveBeenCalled();
 finish();await vi.advanceTimersByTimeAsync(0);
 expect(f.remove).toHaveBeenCalledTimes(1);expect(f.save).not.toHaveBeenCalled();expect(f.core.agents).toEqual([]);
});
it.each([null,[],true,42])('rejects malformed pairing bodies without throwing: %j',async(body)=>{
 const f=fixture(async()=>{});expect((await f.core.route(request(body))).status).toBe(400);
});
