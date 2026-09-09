import { AgentConnectCore, type ConnectHttpRequest } from '@/lib/agent-connect/core';
import { agentCredentialStore, agentMetadataStore } from '@/lib/agent-connect/persistence';
import { projectConnectTools } from '@/lib/agent-connect/tools';

type Invoke=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
function bridge():Invoke|undefined {
 const invoke=(globalThis as unknown as {__TAURI_INTERNALS__?:{invoke?:Invoke}}).__TAURI_INTERNALS__?.invoke;
 return typeof invoke==='function'?invoke:undefined;
}
export interface AgentConnectSnapshot {
 supported:boolean;running:boolean;host:string|null;error:string|null;port?:number;localComputer?:boolean;
}
class DesktopAgentConnectRuntime {
 readonly core=new AgentConnectCore({metadata:agentMetadataStore,credentials:agentCredentialStore,tools:projectConnectTools});
 private state:AgentConnectSnapshot={supported:false,running:false,host:null,error:'Agent Connect is unavailable on web. Use an installed app.'};
 private listeners=new Set<()=>void>();
 private epoch=0;
 private starting:Promise<void>|null=null;
 private timer:ReturnType<typeof setTimeout>|null=null;
 constructor(){this.core.subscribe(()=>{for(const listener of this.listeners)listener();});}
 snapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 private update(value:Partial<AgentConnectSnapshot>){this.state={...this.state,...value};for(const listener of this.listeners)listener();}
 async initialize(){if(!bridge())return;await this.core.load();await this.start();}
 async start(){
  if(this.state.running)return;
  if(this.starting)return this.starting;
  const invoke=bridge();if(!invoke)return;
  const epoch=++this.epoch;
  this.starting=(async()=>{
   try {
    const result=await invoke('agent_transport_start') as {port?:unknown};
    if(epoch!==this.epoch){await invoke('agent_transport_stop');return;}
    if(!Number.isInteger(result?.port)||Number(result.port)<1||Number(result.port)>65535)throw new Error('Invalid desktop agent endpoint.');
    this.update({supported:true,running:true,host:'127.0.0.1',port:Number(result.port),localComputer:true,error:null});
    void this.poll(invoke,epoch);
   }catch(error){if(epoch===this.epoch)this.update({supported:true,running:false,error:error instanceof Error?error.message:String(error)});}
  })().finally(()=>{this.starting=null;});
  return this.starting;
 }
 private async poll(invoke:Invoke,epoch:number):Promise<void>{
  if(epoch!==this.epoch)return;
  try{
   const result=await invoke('agent_transport_poll') as {requests:{id:string;request:ConnectHttpRequest}[]};
   if(epoch!==this.epoch)return;
   if(!Array.isArray(result?.requests)||result.requests.length>16)throw new Error('Invalid desktop agent request queue.');
   for(const message of result.requests){
    // Pairing waits for approval; it must not stall the transport's poll loop.
    void this.core.route(message.request).then(async response=>{
     if(epoch===this.epoch)await invoke('agent_transport_reply',{id:message.id,response});
    }).catch(()=>{ /* Transport timeout reports undeliverable requests without logging credentials. */ });
   }
   this.timer=setTimeout(()=>void this.poll(invoke,epoch),250);
  }catch(error){
   if(epoch!==this.epoch)return;
   this.stop();this.update({error:error instanceof Error?error.message:String(error)});
  }
 }
 stop(){
  ++this.epoch;if(this.timer)clearTimeout(this.timer);this.timer=null;
  void this.core.resolveApproval(false);
  this.update({running:false,host:null,port:undefined});
  void bridge()?.('agent_transport_stop').catch(()=>{});
 }
}
export const agentConnectRuntime=new DesktopAgentConnectRuntime();
