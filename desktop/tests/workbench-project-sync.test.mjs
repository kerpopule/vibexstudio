import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {readProjectRevisions} from '../workbench/project-sync-folder.mjs';
async function fixture(enabled,syncOrigins=[]){
 const root=await mkdtemp(tmpdir()+'/vibex-http-sync-');await mkdir(root+'/sync');
 const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const token='test-only-workbench-sync-token';
 await writeFile(root+'/config.json',JSON.stringify({port,token,syncOrigins,projectsRoot:root+'/builds',...(enabled?{syncFolder:root+'/sync'}:{})}));
 const child=spawn(process.execPath,[new URL('../workbench/server.mjs',import.meta.url).pathname],{env:{...process.env,WORKBENCH_CONFIG:root+'/config.json'},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');let output='';child.stdout.on('data',c=>{output+=c;});child.stderr.on('data',c=>{output+=c;});
 const close=async()=>{if(child.exitCode===null)child.kill('SIGTERM');await exited;await rm(root,{recursive:true,force:true});};
 try{
  const deadline=Date.now()+10_000;
  while(!output.includes('listening on')){if(Date.now()>deadline||child.exitCode!==null)throw new Error(output||'Server did not start');await new Promise(r=>setTimeout(r,20));}
  return {root,close,url:`http://127.0.0.1:${port}`,call:async(body,auth=token,path='/sync')=>fetch(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',headers:{'X-Workbench-Token':auth,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)})};
 }catch(error){await close();throw error;}
}
const payload=(id,text)=>JSON.stringify({format:'vibex/project-snapshot',version:1,content:{meta:{id,name:'Test'},chat:[],files:[{path:'index.html',content:text}]}});
test('authenticated user-owned sync saves and reads revisions without executing projects',async()=>{
 const f=await fixture(true);
 try{
  assert.equal((await f.call({operation:'list'},'wrong')).status,401);
  assert.deepEqual((await (await f.call(undefined,undefined,'/status')).json()).projectSync,{version:1});
  assert.deepEqual(await (await f.call({operation:'list'})).json(),{projects:[]});
  const first=await (await f.call({operation:'append',projectId:'p1',payload:payload('p1','first'),expectedHeads:[]})).json();assert.ok(first.revision);
  assert.equal((await f.call({operation:'append',projectId:'p1',payload:payload('p1','stale'),expectedHeads:[]})).status,409);
  const second=await (await f.call({operation:'append',projectId:'p1',payload:payload('p1','second'),expectedHeads:[first.revision]})).json();assert.ok(second.revision);
  const read=await (await f.call({operation:'read',projectId:'p1',folder:'/ignored'})).json();assert.deepEqual(read.heads,[second.revision]);assert.equal(read.revisions.length,1);assert.equal(read.revisions[0].payload,payload('p1','second'));
  assert.equal((await readProjectRevisions(f.root+'/sync','p1')).revisions.length,2);
  assert.equal((await f.call({operation:'append',projectId:'p1',payload:payload('other','bad'),expectedHeads:[]})).status,400);
  assert.equal((await f.call({operation:'read',projectId:'../escape'})).status,400);
  assert.equal((await f.call({operation:'delete',projectId:'p1'})).status,400);
  assert.deepEqual((await (await f.call(undefined,undefined,'/status')).json()).projects,[]);
 }finally{await f.close();}
});
test('build pairing alone leaves synchronization disabled',async()=>{
 const f=await fixture(false);try{assert.equal((await f.call({operation:'list'})).status,404);assert.equal((await (await f.call(undefined,undefined,'/status')).json()).projectSync,null);}finally{await f.close();}
});

test('browser preflight permits only owner-selected origins and still requires a token',async()=>{
 const origin='https://studio.example.test',f=await fixture(true,[origin]);
 const preflight=(requestOrigin=origin,method='POST',headers='content-type,x-workbench-token')=>fetch(f.url+'/sync',{method:'OPTIONS',headers:{Origin:requestOrigin,'Access-Control-Request-Method':method,'Access-Control-Request-Headers':headers},signal:AbortSignal.timeout(5000)});
 try{
  const allowed=await preflight();assert.equal(allowed.status,204);assert.equal(allowed.headers.get('access-control-allow-origin'),origin);assert.equal(allowed.headers.get('access-control-allow-credentials'),null);
  assert.equal((await preflight('https://other.example.test')).status,403);
  assert.equal((await preflight(origin,'DELETE')).status,403);
  assert.equal((await preflight(origin,'POST','x-extra')).status,403);
  const unauthenticated=await fetch(f.url+'/sync',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"operation":"list"}'});assert.equal(unauthenticated.status,401);assert.equal(unauthenticated.headers.get('access-control-allow-origin'),origin);
  const authenticated=await fetch(f.url+'/sync',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Workbench-Token':'test-only-workbench-sync-token'},body:'{"operation":"list"}'});assert.equal(authenticated.status,200);assert.deepEqual(await authenticated.json(),{projects:[]});
  const rejected=await fetch(f.url+'/sync',{method:'POST',headers:{Origin:'https://other.example.test','Content-Type':'application/json','X-Workbench-Token':'test-only-workbench-sync-token'},body:'{"operation":"list"}'});assert.equal(rejected.status,403);assert.equal(rejected.headers.get('access-control-allow-origin'),null);
 }finally{await f.close();}
});


test('owner invites produce revocable device access without granting device management',async()=>{
 const f=await fixture(true);try{
  const request=(route,method,body,token='test-only-workbench-sync-token')=>fetch(f.url+route,{method,headers:{'Content-Type':'application/json','X-Workbench-Token':token},...(body?{body:JSON.stringify(body)}:{})});
  const issued=await request('/pairing/invites','POST');assert.equal(issued.status,200);assert.equal(issued.headers.get('cache-control'),'no-store');const invite=await issued.json();
  const claimed=await request('/pairing/claim','POST',{code:invite.code,name:'Test phone'},'');assert.equal(claimed.status,200);const device=await claimed.json();assert.notEqual(device.token,'test-only-workbench-sync-token');
  assert.equal((await request('/pairing/claim','POST',{code:invite.code,name:'Replay'},'')).status,410);
  const status=await request('/status','GET',null,device.token);assert.equal(status.status,200);assert.deepEqual((await status.json()).devicePairing,{version:1});
  assert.equal((await request('/sync','POST',{operation:'list'},device.token)).status,200);
  for(const [route,method] of [['/pairing/invites','POST'],['/pairing/devices','GET'],['/pairing/revoke','POST']])assert.equal((await request(route,method,null,device.token)).status,403);
  const list=await (await request('/pairing/devices','GET')).json();assert.equal(list.devices[0].id,device.deviceId);assert(!JSON.stringify(list).includes(device.token));
  assert.equal((await request('/pairing/revoke','POST',{deviceId:device.deviceId})).status,200);
  assert.equal((await request('/status','GET',null,device.token)).status,401);
  assert.equal((await request('/status','GET')).status,200);
 }finally{await f.close();}
});
