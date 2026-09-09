import {it,expect,vi} from 'vitest';
import {createEditingReadTools,createEditingExportStatusTool} from '../src/lib/agent-connect/editing-tools';
const id='cut-1234567890';
const timeline={id,title:'Film',revision:3,fps:24,canUndo:true,canRedo:false,tracks:[{id:'v1',name:'Video',clips:Array.from({length:30},(_,i)=>({id:`clip-${i}`,label:`Clip ${i}`,start:i*24,duration:24,trimIn:0,trimOut:24,sourceFrames:24,sourceUrl:'secret'}))}],captions:[{id:'caption',text:'Hello',start:0,end:1}]};
const deps={server:()=> 'https://media.example',list:async()=>[{id,title:'Film',revision:3,seconds:30,clips:30}],read:async()=>timeline};
it('requires media-read permission on both metadata tools',()=>{
 expect(createEditingReadTools(deps).map(tool=>tool.requiredPermission)).toEqual(['mediaRead','mediaRead']);
});
it('pages clips without losing timing and strips unapproved source fields',async()=>{
 const tool=createEditingReadTools(deps)[1];
 const first=await tool.handler({draftId:id},{} as never) as any;
 expect(first.clips).toHaveLength(25);expect(first.nextOffset).toBe(25);expect(first.fps).toBe(24);
 expect(JSON.stringify(first)).not.toContain('secret');
 const next=await tool.handler({draftId:id,offset:25,revision:3},{} as never) as any;
 expect(next.clips).toHaveLength(5);expect(next.clips[0]).toMatchObject({id:'clip-25',start:600,duration:24});expect(next.nextOffset).toBeNull();
 await expect(tool.handler({draftId:id,revision:2},{} as never)).rejects.toThrow('changed');
});
it('rejects bad input before private reads and discards results after a server switch',async()=>{
 const read=vi.fn(deps.read),tool=createEditingReadTools({...deps,read})[1];
 await expect(tool.handler({draftId:'../file'},{} as never)).rejects.toThrow();
 await expect(tool.handler({draftId:id,offset:-1},{} as never)).rejects.toThrow();expect(read).not.toHaveBeenCalled();
 let server='https://one.example';
 const changed=createEditingReadTools({...deps,server:()=>server,list:async()=>{server='https://two.example';return []}})[0];
 await expect(changed.handler({},{} as never)).rejects.toThrow('changed');
});
it('the MCP gate hides and rejects both tools without media-read consent',async()=>{
 const {AgentConnectCore}=await import('../src/lib/agent-connect/core');
 for(const allowed of [false,true]){
 const list=vi.fn(deps.list),read=vi.fn(deps.read);
 const core=new AgentConnectCore({metadata:{load:async()=>JSON.stringify([{id:'agent',name:'Agent',pairedAt:'now',mediaRead:allowed}]),save:async()=>{}},credentials:{get:async()=> 'token',set:async()=>{},remove:async()=>{}},tools:createEditingReadTools({...deps,list,read})});
 await core.load();
 const call=async(method:string,params?:unknown)=>JSON.parse((await core.route({method:'POST',path:'/mcp',headers:{authorization:'Bearer token'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),remoteAddress:'127.0.0.1'})).body);
 expect((await call('tools/list')).result.tools).toHaveLength(allowed?2:0);
 const result=await call('tools/call',{name:'read_editing_timeline',arguments:{draftId:id}});
 expect(Boolean(result.error)).toBe(!allowed);expect(read).toHaveBeenCalledTimes(allowed?1:0);
 }
});

it('export status requires read consent, strips content URLs and rejects a server switch',async()=>{
 let server='https://media.example';
 const status=vi.fn(async()=>({bytes:123,sha256:'a'.repeat(64),seconds:10,width:640,height:480,fps:24,mimeType:'video/mp4',url:'private-content'} as any));
 const tool=createEditingExportStatusTool({server:()=>server,status});
 expect(tool.requiredPermission).toBe('mediaRead');
 await expect(tool.handler({draftId:'../file',revision:0},{} as never)).rejects.toThrow();
 expect(status).not.toHaveBeenCalled();
 const result=await tool.handler({draftId:id,revision:0},{} as never);
 expect(result).toMatchObject({state:'ready',receipt:{bytes:123}});
 expect(JSON.stringify(result)).not.toContain('private-content');
 const changed=createEditingExportStatusTool({server:()=>server,status:async()=>{server='https://other.example';return null;}});
 await expect(changed.handler({draftId:id,revision:0},{} as never)).rejects.toThrow('changed');
});
