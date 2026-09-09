import {it,expect,vi} from 'vitest';
import {createAgentStoryboardTool} from '../src/lib/agent-connect/storyboard-create';
import {createCollectionTools} from '../src/lib/agent-connect/collection-tools';
const args={requestId:'storyboard-agent-0001',storyboardId:'original',sourceSha256:'a'.repeat(64),title:'Copy',fps:24,musicAssetId:'song',scenes:[{assetId:'clip',seconds:1},{assetId:'clip',seconds:2}]};
const agent={id:'one',name:'Agent',pairedAt:'now'};
it('rejects changed source revisions while an agent reads later storyboard pages',async()=>{
 let digest='a'.repeat(64);
 const tool=createCollectionTools(async()=>[{id:'board',sourceSha256:digest,title:'Film',description:'',details:[],beats:Array.from({length:30},(_,i)=>({title:String(i),description:''}))}])[0];
 const first=await tool.handler({collection:'storyboards',recordId:'board'},agent) as any;
 expect(first.nextOffset).toBe(25);
 await expect(tool.handler({collection:'storyboards',recordId:'board',offset:25,expectedSourceSha256:digest},agent)).resolves.toMatchObject({totalScenes:30});
 digest='b'.repeat(64);
 await expect(tool.handler({collection:'storyboards',recordId:'board',offset:25,expectedSourceSha256:first.record.sourceSha256},agent)).rejects.toThrow('changed');
});
it('preserves all ordered scene choices and isolates retry identities by agent and server',async()=>{
 let origin='https://one.example';
 const create=vi.fn(async(_origin:string,_requestId:string,_input:unknown)=>'cut-1234567890');
 const tool=createAgentStoryboardTool({server:()=>origin,identity:async value=>value,create});
 expect(tool.requiredPermissions).toEqual(['mediaRead','mediaEdit']);
 await tool.handler(args,agent);await tool.handler(args,agent);await tool.handler(args,{...agent,id:'two'});
 origin='https://two.example';await tool.handler(args,agent);
 expect(create.mock.calls[0][1]).toBe(create.mock.calls[1][1]);
 expect(create.mock.calls[0][1]).not.toBe(create.mock.calls[2][1]);expect(create.mock.calls[0][1]).not.toBe(create.mock.calls[3][1]);
 const {requestId:_,...input}=args;expect(create.mock.calls[0][2]).toEqual(input);
});
it('rejects missing choices and detects connection changes before and after submission',async()=>{
 const create=vi.fn(async()=> 'cut-1234567890');let origin='https://one.example';
 const tool=createAgentStoryboardTool({server:()=>origin,identity:async()=>{origin='https://two.example';return 'hash';},create});
 await expect(tool.handler({...args,scenes:[{assetId:'clip',seconds:0}]},agent)).rejects.toThrow('every scene');
 await expect(tool.handler(args,agent)).rejects.toThrow('changed');expect(create).not.toHaveBeenCalled();
 origin='https://one.example';
 const after=createAgentStoryboardTool({server:()=>origin,identity:async()=>'hash',create:async()=>{origin='https://two.example';return 'cut-result';}});
 await expect(after.handler(args,agent)).rejects.toThrow('changed');
});
