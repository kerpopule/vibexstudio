import {it,expect,vi} from 'vitest';
import {createEditingMutationTools} from '../src/lib/agent-connect/editing-mutations';
import {AgentConnectCore} from '../src/lib/agent-connect/core';
const args={draftId:'cut-1234567890',requestId:'request-1234567890',revision:0,commands:[{id:'caption',type:'caption.add',payload:{text:'Hello',start_frame:0,end_frame:24}}]};
const result={id:args.draftId,title:'Film',revision:1,fps:24,canUndo:true,canRedo:false,tracks:[]};
const agent={id:'agent-a',name:'A',pairedAt:'now'};
it('keeps retries identical but separates agent identities without touching UI pending state',async()=>{
 const apply=vi.fn(async(_origin:string,_id:string,_transactionId:string)=>result),identity=vi.fn(async value=>value);
 const tool=createEditingMutationTools({server:()=> 'https://media.example',identity,apply})[0];
 await tool.handler(args,agent);await tool.handler(args,agent);await tool.handler(args,{...agent,id:'agent-b'});
 expect(apply.mock.calls[0][2]).toBe(apply.mock.calls[1][2]);expect(apply.mock.calls[0][2]).not.toBe(apply.mock.calls[2][2]);
});
it('validates payloads before dispatch and aborts after connection changes',async()=>{
 const apply=vi.fn(async()=>result);let origin='https://one.example';
 const tool=createEditingMutationTools({server:()=>origin,identity:async()=>{origin='https://two.example';return 'a'.repeat(64)},apply})[0];
 await expect(tool.handler({...args,commands:[{...args.commands[0],payload:{bad:{url:'file'}}}]},agent)).rejects.toThrow('payload');
 await expect(tool.handler(args,agent)).rejects.toThrow('changed');expect(apply).not.toHaveBeenCalled();
});
it('never grants editing to existing read-only agents, persists explicit new consent',async()=>{
 for(const edit of [false,true]){
 let saved='[]';const tokens=new Map<string,string>(),apply=vi.fn(async()=>result);
 const options={metadata:{load:async()=>saved,save:async(v:string)=>{saved=v;}},credentials:{get:async(id:string)=>tokens.get(id)??null,set:async(id:string,v:string)=>{tokens.set(id,v);},remove:async(id:string)=>{tokens.delete(id);}},tools:createEditingMutationTools({server:()=> 'https://media.example',identity:async()=> 'a'.repeat(64),apply})};
 const core=new AgentConnectCore(options),ticket=core.issueTicket();
 const pending=core.route({method:'POST',path:'/pair',headers:{},body:JSON.stringify({code:ticket.code,agentName:'Test'}),remoteAddress:'127.0.0.1'});
 await core.resolveApproval(true,true,false,false,edit);const token=JSON.parse((await pending).body).token;
 const restored=new AgentConnectCore(options);await restored.load();
 const response=await restored.route({method:'POST',path:'/mcp',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'apply_editing_commands',arguments:args}}),remoteAddress:'127.0.0.1'});
 expect(Boolean(JSON.parse(response.body).error)).toBe(!edit);expect(apply).toHaveBeenCalledTimes(edit?1:0);
 }
});
