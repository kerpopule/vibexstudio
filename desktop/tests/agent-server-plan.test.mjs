import {test} from 'node:test';import assert from 'node:assert/strict';
import {planAgentServer} from '../workbench/agent-server-plan.mjs';
const key=n=>'ssh-ed25519 '+Buffer.concat([Buffer.from([0,0,0,11]),Buffer.from('ssh-ed25519'),Buffer.from([0,0,0,32]),Buffer.alloc(32,n)]).toString('base64');
const device={id:'desktop',port:18801,publicKey:key(1)};
test('requires server policy and unique loopback-only device keys together',()=>{
 const plan=planAgentServer({user:'vibex_agent',devices:[device,{id:'phone',port:18802,publicKey:key(2)}]});
 assert.equal(plan.requiresBothFiles,true);assert.ok(plan.authorizedKeys.includes('permitlisten="127.0.0.1:18801"'));
 for(const policy of ['MaxSessions 0','AllowTcpForwarding remote','GatewayPorts no','AllowStreamLocalForwarding no','PermitOpen none'])assert.ok(plan.sshdConfig.includes(policy));
});
test('rejects collisions and malformed enrollment before producing files',()=>{
 for(const second of [{...device,id:'other'},{...device,port:18802},{...device,id:'other',port:18802}])assert.throws(()=>planAgentServer({user:'agent',devices:[device,second]}));
 assert.throws(()=>planAgentServer({user:'agent',devices:[device,{id:'other',port:18802,publicKey:device.publicKey+'='}]}));
 assert.throws(()=>planAgentServer({user:'agent\nMatch all',devices:[device]}));
 assert.throws(()=>planAgentServer({user:'agent',devices:[{...device,publicKey:'ssh-ed25519 AAAA'}]}));
});
