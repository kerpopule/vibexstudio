import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planAgentTunnel} from '../workbench/agent-ssh-plan.mjs';
const key=Buffer.concat([Buffer.from([0,0,0,11]),Buffer.from('ssh-ed25519'),Buffer.from([0,0,0,32]),Buffer.alloc(32,7)]).toString('base64');
const config={version:1,host:'owned.example',user:'agent',sshPort:443,remotePort:18801,hostKey:`ssh-ed25519 ${key}`};
const options={localPort:53931,identityFile:'/private/key',knownHostsFile:'/private/hosts'};
test('creates shell-free private reverse forwarding with pinned identity',()=>{
 const plan=planAgentTunnel(config,options);
 assert.equal(plan.executable,'ssh');assert.ok(plan.args.includes('StrictHostKeyChecking=yes'));assert.ok(plan.args.includes('ExitOnForwardFailure=yes'));
 assert.equal(plan.args[plan.args.indexOf('-R')+1],'127.0.0.1:18801:127.0.0.1:53931');
 assert.equal(plan.knownHosts,`[owned.example]:443 ssh-ed25519 ${key}\n`);
 assert.equal(plan.remoteEndpoint,'http://127.0.0.1:18801/mcp');
});
test('rejects malformed enrollment or unsafe file paths',()=>{
 for(const patch of [{host:'-oProxyCommand=bad'},{user:'a;bad'},{sshPort:0},{remotePort:80},{hostKey:'ssh-ed25519 AAAA'},{hostKey:config.hostKey+'\ninjected'}])assert.throws(()=>planAgentTunnel({...config,...patch},options));
 assert.throws(()=>planAgentTunnel(config,{...options,identityFile:'relative'}));
 assert.throws(()=>planAgentTunnel(config,{...options,localPort:0}));
});
test('keeps Windows paths as individual arguments and disables inherited ssh config',()=>{
 const plan=planAgentTunnel(config,{platform:'win32',localPort:53931,identityFile:'C:\\User Data\\key',knownHostsFile:'C:\\User Data\\hosts'});
 assert.deepEqual(plan.args.slice(0,2),['-F','NUL']);assert.ok(plan.args.includes('C:\\User Data\\key'));
});
test('uses standard known-host identity at port 22 and quotes paths with spaces',()=>{
 const plan=planAgentTunnel({...config,sshPort:22},{...options,knownHostsFile:'/private/My Data/hosts'});
 assert.equal(plan.knownHosts,`owned.example ssh-ed25519 ${key}\n`);
 assert.ok(plan.args.includes('UserKnownHostsFile="/private/My Data/hosts"'));
});
