import {it,expect,vi} from 'vitest';
import {AgentConnectCore} from '../src/lib/agent-connect/core';
import {createSaveEditingExportTool,createEditingRenderTools} from '../src/lib/agent-connect/editing-render';
const draftId='cut-1234567890';
it('old edit consent cannot render; new render consent survives metadata load and gates calls',async()=>{
 for(const permission of [undefined,false,true]){
  const start=vi.fn(async()=>({projectId:draftId,revision:0,state:'running' as const,receipt:null}));
  const core=new AgentConnectCore({metadata:{load:async()=>JSON.stringify([{id:'agent',name:'Agent',pairedAt:'now',mediaRead:true,mediaEdit:true,mediaRender:permission}]),save:async()=>{}},credentials:{get:async()=> 'token',set:async()=>{},remove:async()=>{}},tools:createEditingRenderTools({server:()=> 'https://lab.example',start,read:start})});
  await core.load();
  const call=async(method:string,params?:unknown)=>JSON.parse((await core.route({method:'POST',path:'/mcp',headers:{authorization:'Bearer token'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),remoteAddress:'127.0.0.1'})).body);
  const names=(await call('tools/list')).result.tools.map((t:any)=>t.name);
  expect(names.includes('start_editing_export')).toBe(permission===true);
  expect(names.includes('read_editing_export_job')).toBe(true);
  const result=await call('tools/call',{name:'start_editing_export',arguments:{draftId,revision:0}});
  expect(Boolean(result.error)).toBe(permission!==true);
  expect(start).toHaveBeenCalledTimes(permission===true?1:0);
 }
});
it('validates before dispatch, checks server identity and filters receipt fields',async()=>{
 let server='https://lab.example';
 const start=vi.fn(async(_o:string,_i:string,_r:number,check:()=>void)=>{server='https://other.example';check();return null as never;});
 const read=vi.fn(async()=>({projectId:draftId,revision:0,state:'ready' as const,receipt:{bytes:10,url:'private-content'} as any}));
 const [run,status]=createEditingRenderTools({server:()=>server,start,read});
 await expect(run.handler({draftId:'../x',revision:0},{} as never)).rejects.toThrow();expect(start).not.toHaveBeenCalled();
 await expect(run.handler({draftId,revision:0},{} as never)).rejects.toThrow('changed');
 expect(JSON.stringify(await status.handler({draftId,revision:0},{} as never))).not.toContain('private-content');
});

it('saving a completed export requires render consent and retains the returned Library identity',async()=>{
 const save=vi.fn(async()=> 'import-'+'a'.repeat(64)+'-mp4');
 const tool=createSaveEditingExportTool({server:()=> 'https://lab.example',save});
 expect(tool.requiredPermissions).toEqual(['mediaRead','mediaRender']);
 await expect(tool.handler({draftId:'../x',revision:0},{} as never)).rejects.toThrow();expect(save).not.toHaveBeenCalled();
 expect(await tool.handler({draftId,revision:0},{} as never)).toMatchObject({assetId:'import-'+'a'.repeat(64)+'-mp4',kind:'video'});
});
