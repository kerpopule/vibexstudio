import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
test('owned worker lists, saves and reads heads only in its selected folder',async()=>{
 const root=await mkdtemp(tmpdir()+'/vibex-sync-worker-');
 const invoke=request=>{
  const result=spawnSync(process.execPath,[new URL('../workbench/project-sync-worker.mjs',import.meta.url).pathname,'--folder',root],{input:JSON.stringify(request),encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
 };
 try{
  assert.deepEqual(invoke({operation:'list'}),{projects:[]});
  const first=invoke({operation:'append',projectId:'p1',payload:'first',expectedHeads:[]});
  const second=invoke({operation:'append',projectId:'p1',payload:'second',expectedHeads:[first.revision]});
  assert.deepEqual(invoke({operation:'list'}),{projects:['p1']});
  const read=invoke({operation:'read',projectId:'p1',folder:'/ignored'});
  assert.deepEqual(read.heads,[second.revision]);assert.equal(read.revisions.length,1);assert.equal(read.revisions[0].payload,'second');
  assert.ok((await readFile(root+'/VibeXStudioSync/v1/projects/p1/'+first.revision+'.json','utf8')).includes('first'));
  const denied=spawnSync(process.execPath,[new URL('../workbench/project-sync-worker.mjs',import.meta.url).pathname,'--folder',root],{input:JSON.stringify({operation:'append',projectId:'../escape',payload:'bad',expectedHeads:[]}),encoding:'utf8',timeout:5000});
  assert.equal(denied.status,1);assert.equal(denied.stdout,'');
 }finally{await rm(root,{recursive:true,force:true});}
});
