import {it,expect,vi} from 'vitest';
import {createAgentDraftTool} from '../src/lib/agent-connect/editing-create';
const args={requestId:'create-request-0001',title:'My film',assetIds:['video','song']};
const agent={id:'one',name:'Agent',pairedAt:'now'};
it('preserves ordered media and separates agent request identities',async()=>{
 const create=vi.fn(async(_origin:string,_requestId:string,_input:unknown)=>'cut-1234567890');
 const tool=createAgentDraftTool({server:()=> 'https://media.example',identity:async value=>value,create});
 expect(tool.requiredPermissions).toEqual(['mediaRead','mediaEdit']);
 await tool.handler(args,agent);await tool.handler(args,agent);await tool.handler(args,{...agent,id:'two'});
 expect(create.mock.calls[0][1]).toBe(create.mock.calls[1][1]);expect(create.mock.calls[0][1]).not.toBe(create.mock.calls[2][1]);
 expect(create.mock.calls[0][2]).toEqual({title:'My film',assetIds:['video','song']});
});
it('rejects invalid sources before dispatch and stops on server changes',async()=>{
 const create=vi.fn(async()=> 'cut-1234567890');let origin='https://one.example';
 const tool=createAgentDraftTool({server:()=>origin,identity:async()=>{origin='https://two.example';return 'x'},create});
 for(const assetIds of [[],['same','same'],['../file'],Array.from({length:9},(_,i)=>String(i))])await expect(tool.handler({...args,assetIds},agent)).rejects.toThrow('asset IDs');
 await expect(tool.handler(args,agent)).rejects.toThrow('changed');expect(create).not.toHaveBeenCalled();
});
