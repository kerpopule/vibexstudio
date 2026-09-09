import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';
import {deviceIdentity} from '../workbench/agent-device-identity.mjs';import {connectAgentServer} from '../workbench/agent-remote-connection.mjs';
test('binds enrollment to this identity before spawning and cleans connection files',{skip:process.platform==='win32'},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vibex-remote-test-'));const directory=path.join(root,'device');
 try{
  const identity=await deviceIdentity(directory,{create:true});const other=await deviceIdentity(path.join(root,'other'),{create:true});
  const enrollment={version:1,host:'owned.example',user:'agent',sshPort:443,remotePort:18801,hostKey:other.publicKey,devicePublicKey:other.publicKey};
  let calls=0;const child=new EventEmitter();child.stderr={resume(){}};child.kill=()=>child.emit('exit',0);
  const dependencies={spawnProcess:()=>{calls++;return child;}};
  await assert.rejects(connectAgentServer(directory,enrollment,53931,dependencies),/another device/);assert.equal(calls,0);
  await assert.rejects(connectAgentServer(directory,{...enrollment,devicePublicKey:identity.publicKey},53931,{...dependencies,beforeSpawn:()=>{throw new Error('cancelled');}}),/cancelled/);
  assert.equal(calls,0);assert.deepEqual((await readdir(directory)).sort(),['identity','identity.pub']);
  const connection=await connectAgentServer(directory,{...enrollment,devicePublicKey:identity.publicKey},53931,dependencies);
  assert.equal(calls,1);const staged=(await readdir(directory)).find(name=>name.startsWith('connection-'));assert.ok(staged);
  assert.match(await readFile(path.join(directory,staged,'known_hosts'),'utf8'),/^\[owned.example\]:443 ssh-ed25519 /);
  child.emit('spawn');assert.equal(connection.snapshot().verified,false);await connection.stop();
  assert.deepEqual((await readdir(directory)).sort(),['identity','identity.pub']);
 }finally{await rm(root,{recursive:true,force:true});}
});
