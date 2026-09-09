import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import net from 'node:net';import {once} from 'node:events';import {spawn} from 'node:child_process';
import {prepareWorkbench} from '../scripts/prepare-workbench-server.mjs';import {managePairing} from '../workbench/pair-cli.mjs';
test('prepares and runs a standalone server with owner-managed invitations',async()=>{
 const root=await mkdtemp(tmpdir()+'/vibex-headless-test-');let child,exited;
 try{
  await mkdir(root+'/sync');const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const result=await prepareWorkbench({output:root+'/server',port,syncFolder:root+'/sync'});assert.equal(result.syncEnabled,true);assert(!JSON.stringify(result).includes('token'));
  if(process.platform!=='win32')assert.equal((await stat(root+'/server/workbench.json')).mode&0o777,0o600);
  child=spawn(process.execPath,[root+'/server/run.mjs'],{env:{...process.env,WORKBENCH_PARENT_PID:'1'},stdio:['ignore','pipe','pipe']});exited=once(child,'exit');let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
  const deadline=Date.now()+5000;while(!output.includes('listening on')){if(child.exitCode!==null||Date.now()>deadline)throw new Error(output);await new Promise(r=>setTimeout(r,20));}
  const url=`http://127.0.0.1:${port}`,config=root+'/server/workbench.json',invite=await managePairing(config,'invite',[url]);const link=new URL(invite.pairLink);assert(!link.searchParams.has('wbt'));
  const device=await (await fetch(url+'/pairing/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:link.searchParams.get('wbi'),name:'Headless test'})})).json();
  assert.equal((await managePairing(config,'devices')).devices.length,1);
  const response=await fetch(url+'/sync',{method:'POST',headers:{'X-Workbench-Token':device.token,'Content-Type':'application/json'},body:'{"operation":"list"}'});assert.equal(response.status,200);
  await managePairing(config,'revoke',[device.deviceId]);assert.equal((await fetch(url+'/status',{headers:{'X-Workbench-Token':device.token}})).status,401);
  await assert.rejects(prepareWorkbench({output:root+'/server',port}),/already exists/);
 }finally{if(child&&child.exitCode===null)child.kill('SIGTERM');if(exited)await exited;await rm(root,{recursive:true,force:true});}
});
test('rejects invalid storage and origins before creating output',async()=>{
 const root=await mkdtemp(tmpdir()+'/vibex-headless-validation-');try{
  await assert.rejects(prepareWorkbench({output:root+'/server',origins:['*']}),/origins/);
  await assert.rejects(prepareWorkbench({output:root+'/server',syncFolder:'relative'}));
  await assert.rejects(stat(root+'/server'));
 }finally{await rm(root,{recursive:true,force:true});}
});
