import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,symlink,mkdir,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';
import {appendProjectRevision,readProjectRevisions} from '../workbench/project-sync-folder.mjs';
async function fixture(fn){const root=await mkdtemp(tmpdir()+'/vibex-folder-sync-');try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
test('retains immutable history and detects stale save without overwriting',()=>fixture(async root=>{
 const first=await appendProjectRevision(root,'project-1','first',[]);
 const second=await appendProjectRevision(root,'project-1','second',[first.revision]);
 await assert.rejects(appendProjectRevision(root,'project-1','stale',[first.revision]),/folder changed/);
 const result=await readProjectRevisions(root,'project-1');assert.equal(result.revisions.length,2);assert.deepEqual(result.heads,[second.revision]);
 assert.ok(result.revisions.some(r=>r.payload==='first'));
}));
test('simultaneous device saves preserve both branches, explicit merge retains originals',()=>fixture(async root=>{
 const base=await appendProjectRevision(root,'project','base',[]);
 let release;const gate=new Promise(r=>release=r);let ready=0;
 const beforePublish=async()=>{if(++ready===2)release();await gate;};
 await Promise.all([appendProjectRevision(root,'project','device A',[base.revision],{beforePublish}),appendProjectRevision(root,'project','device B',[base.revision],{beforePublish})]);
 const branched=await readProjectRevisions(root,'project');assert.equal(branched.heads.length,2);assert.equal(branched.revisions.length,3);
 const merged=await appendProjectRevision(root,'project','user-reviewed merge',branched.heads);
 const result=await readProjectRevisions(root,'project');assert.equal(result.revisions.length,4);assert.deepEqual(result.heads,[merged.revision]);
}));
test('failed publication leaves old revision usable and removes staging file',()=>fixture(async root=>{
 const base=await appendProjectRevision(root,'p','base',[]);
 await assert.rejects(appendProjectRevision(root,'p','new',[base.revision],{beforePublish:()=>{throw new Error('interrupted');}}));
 assert.deepEqual((await readProjectRevisions(root,'p')).heads,[base.revision]);
 assert.equal((await readdir(root+'/VibeXStudioSync/v1/projects/p')).length,1);
}));
test('rejects traversal, symlink roots, corrupt data and missing provider history',()=>fixture(async root=>{
 await assert.rejects(appendProjectRevision(root,'../escape','data',[]));
 await mkdir(root+'/actual');await symlink(root+'/actual',root+'/linked','dir');await assert.rejects(appendProjectRevision(root+'/linked','p','data',[]));
 const base=await appendProjectRevision(root,'p','base',[]);const file=root+'/VibeXStudioSync/v1/projects/p/'+base.revision+'.json';
 const original=await readFile(file,'utf8');const broken=JSON.parse(original);broken.payload='corrupt';await writeFile(file,JSON.stringify(broken));
 await assert.rejects(readProjectRevisions(root,'p'),/Damaged/);
 await writeFile(file,original);await appendProjectRevision(root,'p','next',[base.revision]);await rm(file);
 await assert.rejects(readProjectRevisions(root,'p'),/history has not arrived/);
}));
