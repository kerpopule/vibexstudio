import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {startAgentTunnel} from '../workbench/agent-tunnel.mjs';
const key='ssh-ed25519 '+Buffer.concat([Buffer.from([0,0,0,11]),Buffer.from('ssh-ed25519'),Buffer.from([0,0,0,32]),Buffer.alloc(32,1)]).toString('base64');
const config={version:1,host:'127.0.0.1',user:'agent',sshPort:1,remotePort:18801,hostKey:key};
const options={localPort:53931,identityFile:'/tmp/unused-review-key',knownHostsFile:'/tmp/unused-review-hosts'};
test('tracks process lifecycle without claiming verified connectivity',async()=>{
 const child=new EventEmitter();child.stderr={resume(){}};const signals=[];child.kill=s=>{signals.push(s);child.emit('exit',0);};
 const tunnel=startAgentTunnel(config,options,{spawnProcess:(exe,args,opts)=>{assert.equal(exe,'ssh');assert.equal(opts.shell,false);assert.ok(args.includes('ConnectTimeout=15'));return child;}});
 child.emit('spawn');assert.equal(tunnel.snapshot().phase,'process-running');assert.equal(tunnel.snapshot().verified,false);
 await tunnel.stop();assert.equal(tunnel.snapshot().phase,'stopped');assert.deepEqual(signals,['SIGTERM']);await tunnel.stop();assert.equal(signals.length,1);
});
test('unexpected exit is failure even when SSH exits with code zero',async()=>{
 const child=new EventEmitter();child.stderr={resume(){}};
 const tunnel=startAgentTunnel(config,options,{spawnProcess:()=>child});child.emit('spawn');child.emit('exit',0);
 assert.equal((await tunnel.finished).phase,'failed');assert.equal(tunnel.snapshot().verified,false);
});
test('installed SSH reports a refused local test endpoint as failure',async()=>{
 const tunnel=startAgentTunnel(config,options);
 const timeout=setTimeout(()=>void tunnel.stop(),20000);
 try{assert.equal((await tunnel.finished).phase,'failed');assert.equal(tunnel.snapshot().verified,false);}finally{clearTimeout(timeout);await tunnel.stop();}
});
test('forces cleanup if the owned process ignores termination',async()=>{
 const child=new EventEmitter();child.stderr={resume(){}};const signals=[];
 child.kill=signal=>{signals.push(signal);if(signal==='SIGKILL')child.emit('exit',null);};
 const tunnel=startAgentTunnel(config,options,{spawnProcess:()=>child,killAfterMs:10});
 const keepAlive=setTimeout(()=>{},1000);
 try{await tunnel.stop();assert.deepEqual(signals,['SIGTERM','SIGKILL']);assert.equal(tunnel.snapshot().phase,'stopped');}finally{clearTimeout(keepAlive);}
});
