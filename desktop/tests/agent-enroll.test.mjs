import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {tmpdir} from 'node:os';import path from 'node:path';
test('native enrollment CLI returns only a stable public key and preserves broken identities',{skip:process.platform==='win32'},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vibex-enroll-test-'));const directory=path.join(root,'device');
 const run=()=>spawnSync(process.execPath,[new URL('../workbench/agent-enroll.mjs',import.meta.url).pathname,'--directory',directory],{encoding:'utf8',timeout:35000});
 try{
  const first=run();assert.equal(first.status,0);const result=JSON.parse(first.stdout);assert.deepEqual(Object.keys(result),['publicKey']);assert.match(result.publicKey,/^ssh-ed25519 /);
  const original=await readFile(path.join(directory,'identity'));assert.equal(run().stdout,first.stdout);
  await writeFile(path.join(directory,'identity.pub'),'broken');const failed=run();assert.equal(failed.status,1);assert.equal(failed.stdout,'');
  assert.deepEqual(await readFile(path.join(directory,'identity')),original);
 }finally{await rm(root,{recursive:true,force:true});}
});
