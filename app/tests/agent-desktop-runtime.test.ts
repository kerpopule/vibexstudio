import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../src/lib/agent-connect/tools',()=>({projectConnectTools:[]}));
vi.mock('../src/lib/agent-connect/persistence',()=>({
 agentMetadataStore:{load:async()=>null,save:async()=>{}},
 agentCredentialStore:{get:async()=>null,set:async()=>{},remove:async()=>{}},
}));
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();vi.resetModules();});
it('polls pairing without blocking on approval and stops its owned transport',async()=>{
 vi.useFakeTimers();let requests:unknown[]=[];
 const invoke=vi.fn(async(command:string)=>{
  if(command==='agent_transport_start')return {port:12345};
  if(command==='agent_transport_poll'){const result={requests};requests=[];return result;}
  return null;
 });
 vi.stubGlobal('__TAURI_INTERNALS__',{invoke});
 const {agentConnectRuntime:runtime}=await import('../src/lib/agent-connect/runtime');
 await runtime.initialize();expect(runtime.snapshot()).toMatchObject({running:true,localComputer:true,port:12345});
 const ticket=runtime.core.issueTicket();
 requests=[{id:'request-1',request:{method:'POST',path:'/pair',headers:{},body:JSON.stringify({code:ticket.code,agentName:'Hermes'}),remoteAddress:'127.0.0.1'}}];
 await vi.advanceTimersByTimeAsync(250);expect(runtime.core.pendingApproval?.agentName).toBe('Hermes');
 await vi.advanceTimersByTimeAsync(250);expect(invoke.mock.calls.filter(c=>c[0]==='agent_transport_poll').length).toBeGreaterThanOrEqual(3);
 await runtime.core.resolveApproval(false);await vi.advanceTimersByTimeAsync(0);
 expect(invoke.mock.calls.some(c=>c[0]==='agent_transport_reply')).toBe(true);
 runtime.stop();await vi.advanceTimersByTimeAsync(500);
 expect(runtime.snapshot().running).toBe(false);expect(invoke).toHaveBeenLastCalledWith('agent_transport_stop');
});

it('keeps ordinary web builds unavailable without starting transport',async()=>{
 vi.stubGlobal('__TAURI_INTERNALS__',undefined);
 const {agentConnectRuntime:runtime}=await import('../src/lib/agent-connect/runtime');
 await runtime.initialize();
 expect(runtime.snapshot()).toMatchObject({supported:false,running:false});
 expect(runtime.snapshot().error).toContain('unavailable on web');
});
