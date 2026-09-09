import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,chmod,readFile,writeFile,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {deviceIdentity} from '../workbench/agent-device-identity.mjs';
test('generates and reloads one dedicated identity without overwriting it',{skip:process.platform==='win32'},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vibex-key-test-'));const directory=path.join(root,'device');
 try {
  const created=await deviceIdentity(directory,{create:true});assert.match(created.publicKey,/^ssh-ed25519 /);
  const before=await readFile(created.identityFile);
  assert.deepEqual(await deviceIdentity(directory),created);
  await assert.rejects(deviceIdentity(directory,{create:true}));assert.deepEqual(await readFile(created.identityFile),before);
  await chmod(created.identityFile,0o644);await assert.rejects(deviceIdentity(directory),/private file/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('rejects symbolic identity directories and mismatched public key files',{skip:process.platform==='win32'},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vibex-key-test-'));const directory=path.join(root,'device');
 try {
  await deviceIdentity(directory,{create:true});
  await symlink(directory,path.join(root,'alias'));await assert.rejects(deviceIdentity(path.join(root,'alias')),/directory must be private/);
  const other=await deviceIdentity(path.join(root,'other'),{create:true});
  await writeFile(path.join(directory,'identity.pub'),other.publicKey);await assert.rejects(deviceIdentity(directory),/do not match/);
  await writeFile(path.join(directory,'identity.pub'),'ssh-ed25519 AAAA');await assert.rejects(deviceIdentity(directory),/Invalid Ed25519/);
 }finally{await rm(root,{recursive:true,force:true});}
});
