import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,symlink,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {prepareAgentServerEnrollment,writeAgentServerEnrollment} from '../workbench/agent-server-enrollment.mjs';
const key=n=>'ssh-ed25519 '+Buffer.concat([Buffer.from([0,0,0,11]),Buffer.from('ssh-ed25519'),Buffer.from([0,0,0,32]),Buffer.alloc(32,n)]).toString('base64');
const config={host:'spark.example.test',user:'vibex_agent',sshPort:22,hostKey:key(1),devices:[{id:'laptop',port:19841,publicKey:key(2)},{id:'desktop',port:19842,publicKey:key(3)}]};
test('codes use matching per-device keys and assigned ports without claiming installation',()=>{
 const result=prepareAgentServerEnrollment({...config,privateKey:'not propagated'});
 assert.equal(result.requiresInstallation,true);assert.equal(result.status,'prepared');
 assert.deepEqual(result.devices.map(x=>[x.id,x.enrollment.remotePort,x.enrollment.devicePublicKey]),config.devices.map(x=>[x.id,x.port,x.publicKey.replace(/=+$/,'')]));
 assert.ok(!JSON.stringify(result).includes('not propagated'));
 assert.throws(()=>prepareAgentServerEnrollment({...config,host:'https://server'}));
});
test('CLI writes private new bundle, rejects collisions and leaves existing files unchanged',async()=>{
 const root=await mkdtemp(tmpdir()+'/vibex-enrollment-test-');
 try{
  const output=root+'/bundle';
  const command=()=>spawnSync(process.execPath,[new URL('../scripts/prepare-agent-server.mjs',import.meta.url).pathname,'--output',output],{input:JSON.stringify(config),encoding:'utf8'});
  const first=command();assert.equal(first.status,0,first.stderr);assert.equal(JSON.parse(first.stdout).requiresInstallation,true);
  const original=await readFile(output+'/authorized_keys','utf8');assert.ok(original.includes('127.0.0.1:19842'));
  assert.ok((await readFile(output+'/README.txt','utf8')).includes('NOT INSTALLED'));
  assert.equal(command().status,1);assert.equal(await readFile(output+'/authorized_keys','utf8'),original);
  if(process.platform!=='win32'){assert.equal((await stat(output)).mode&0o777,0o700);assert.equal((await stat(output+'/connection-codes.json')).mode&0o777,0o600);}
  await symlink(output,root+'/link','dir');await assert.rejects(writeAgentServerEnrollment(config,root+'/link'));
  await assert.rejects(writeAgentServerEnrollment({...config,devices:[config.devices[0],config.devices[0]]},root+'/invalid'));
  await assert.rejects(stat(root+'/invalid'));
 }finally{await rm(root,{recursive:true,force:true});}
});
