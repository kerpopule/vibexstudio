import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,symlink,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';
import {createDevicePairing} from '../workbench/device-pairing.mjs';
async function fixture(run){const root=await mkdtemp(tmpdir()+'/vibex-device-pair-');try{await run(root+'/devices.json',root);}finally{await rm(root,{recursive:true,force:true});}}
test('single-use invitations persist only hashed device credentials and support revocation',()=>fixture(async file=>{
 const registry=await createDevicePairing(file,'owner-secret');const invite=registry.issue(),device=await registry.claim(invite.code,'Phone');
 assert.equal(registry.authorized(device.token),true);await assert.rejects(registry.claim(invite.code,'Again'),/already used/);
 const stored=await readFile(file,'utf8');assert(!stored.includes(device.token));assert(!stored.includes(invite.code));assert(!stored.includes('owner-secret'));
 if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o777,0o600);
 const restarted=await createDevicePairing(file,'owner-secret');assert(restarted.authorized(device.token));assert.equal(restarted.list()[0].name,'Phone');assert(!JSON.stringify(restarted.list()).includes('hash'));
 await restarted.revoke(device.deviceId);assert(!restarted.authorized(device.token));assert(!(await createDevicePairing(file,'owner-secret')).authorized(device.token));
}));
test('expiry and owner credential rotation invalidate access',()=>fixture(async file=>{
 let time=1;const registry=await createDevicePairing(file,'owner',{now:()=>time});const expired=registry.issue();time+=300_000;
 await assert.rejects(registry.claim(expired.code,'Phone'),/expired/);
 const device=await registry.claim(registry.issue().code,'Phone');assert(!(await createDevicePairing(file,'rotated')).authorized(device.token));
}));
test('concurrent claims cannot reuse an invitation or lose device records',()=>fixture(async file=>{
 const registry=await createDevicePairing(file,'owner'),a=registry.issue(),b=registry.issue();
 const claims=await Promise.allSettled([registry.claim(a.code,'One'),registry.claim(a.code,'Replay'),registry.claim(b.code,'Two')]);
 assert.equal(claims.filter(r=>r.status==='fulfilled').length,2);assert.equal((await createDevicePairing(file,'owner')).list().length,2);
}));
test('bounds outstanding invitations and rejects malformed claims',()=>fixture(async file=>{
 const registry=await createDevicePairing(file,'owner');const invite=registry.issue();
 await assert.rejects(registry.claim(invite.code,'\n'),/device name/);assert.equal(registry.list().length,0);
 for(let i=1;i<8;i++)registry.issue();assert.throws(()=>registry.issue(),/Too many/);
 await assert.rejects(registry.claim('../escape','Phone'),/expired/);assert.equal(registry.authorized('wrong'),false);
}));
test('fails closed on a corrupted or symlinked registry',()=>fixture(async(file,root)=>{
 await writeFile(file,'invalid');await assert.rejects(createDevicePairing(file,'owner'));
 await rm(file);await writeFile(root+'/target','{}');await symlink(root+'/target',file);await assert.rejects(createDevicePairing(file,'owner'),/Invalid/);
}));
