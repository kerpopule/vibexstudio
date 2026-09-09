import {test} from 'node:test';
import {createAgentTransport} from '../workbench/agent-transport.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';import {userInfo,tmpdir} from 'node:os';import net from 'node:net';
import {deviceIdentity} from '../workbench/agent-device-identity.mjs';
import {prepareAgentServerEnrollment} from '../workbench/agent-server-enrollment.mjs';
import {planAgentTunnel} from '../workbench/agent-ssh-plan.mjs';
import {connectAgentServer} from '../workbench/agent-remote-connection.mjs';
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('isolated OpenSSH tunnel enforces generated policy',{skip:process.env.VIBEX_TEST_SSHD!=='1'},async()=>{
const {default:ts}=await import('../../app/node_modules/typescript/lib/typescript.js');
const source=await readFile(new URL('../../app/src/lib/agent-connect/core.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {AgentConnectCore}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const core=new AgentConnectCore({metadata:{load:async()=>JSON.stringify([{id:'fixture',name:'Test',pairedAt:'2026-09-05'}]),save:async()=>{}},credentials:{get:async()=> 'fixture-token',set:async()=>{},remove:async()=>{}},tools:[{name:'list_projects',description:'Test projects',inputSchema:{type:'object',properties:{}},handler:()=>({projects:[]})}]});
await core.load();
const transport=createAgentTransport(message=>{void core.route(message.request).then(response=>transport.reply(message.id,response));});
const root=await mkdtemp(tmpdir()+'/vibex-16gc-');let daemon,tunnel,worker;let daemonErrors='';const echo=transport.server;
try {
 const device=await deviceIdentity(root+'/device',{create:true});
 const generated=spawnSync('ssh-keygen',['-q','-t','ed25519','-N','','-f',root+'/host']);if(generated.status)throw new Error('Host key generation failed');
 const hostKey=(await readFile(root+'/host.pub','utf8')).trim().split(/\s+/).slice(0,2).join(' ');
 const sshPort=await freePort(),remotePort=await freePort();await new Promise(r=>echo.listen(0,'127.0.0.1',r));const localPort=echo.address().port;
 const user=userInfo().username;const plan=prepareAgentServerEnrollment({host:'127.0.0.1',user,sshPort,hostKey,devices:[{id:'test',port:remotePort,publicKey:device.publicKey}]});
 await writeFile(root+'/authorized_keys',plan.authorizedKeys,{mode:0o600});
 await writeFile(root+'/sshd_config',`ListenAddress 127.0.0.1\nPort ${sshPort}\nHostKey ${root}/host\nPidFile ${root}/pid\nAuthorizedKeysFile ${root}/authorized_keys\nUsePAM no\nLogLevel ERROR\n`+plan.sshdConfig,{mode:0o600});
 daemon=spawn('/usr/sbin/sshd',['-D','-e','-f',root+'/sshd_config'],{stdio:['ignore','ignore','pipe']});daemon.stderr.on('data',b=>{daemonErrors+=b.toString();});
 const config=plan.devices[0].enrollment;
 const options={localPort,identityFile:device.identityFile,knownHostsFile:root+'/known_hosts'};
 await writeFile(options.knownHostsFile,planAgentTunnel(config,options).knownHosts,{mode:0o600});
 await new Promise(r=>setTimeout(r,300));
 if(daemon.exitCode!==null)throw new Error('Isolated sshd exited: '+daemonErrors);
 tunnel=await connectAgentServer(root+'/device',{...config,devicePublicKey:device.publicKey},localPort);
 let success=false;
 for(let i=0;i<30;i++){
  try{const r=await fetch(`http://127.0.0.1:${remotePort}/mcp`,{method:'POST',headers:{Authorization:'Bearer fixture-token','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_projects',arguments:{}}}),signal:AbortSignal.timeout(500)});const data=await r.json();if(data.result?.isError===false&&Array.isArray(data.result?.structuredContent?.projects)){success=true;break;}}catch{}
  if(tunnel.snapshot().phase==='failed')break;await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(tunnel.snapshot().verified,false); // Verification evidence does not automatically grant runtime enrollment.

 if(!success)throw new Error('Tunnel acceptance failed. sshd: '+daemonErrors);
 assert.equal((await fetch(`http://127.0.0.1:${remotePort}/mcp`,{method:'POST',body:'{}'})).status,401);
 const deniedPlan=planAgentTunnel({...config,remotePort:await freePort()},options);
 const denied=spawnSync('ssh',deniedPlan.args,{timeout:5000,encoding:'utf8'});
 assert.equal(denied.status,255,'Unassigned remote port must fail before timeout');
 const wrongOptions={...options,knownHostsFile:root+'/wrong_hosts'};
 const wrongPlan=planAgentTunnel({...config,hostKey:device.publicKey},wrongOptions);
 await writeFile(wrongOptions.knownHostsFile,wrongPlan.knownHosts,{mode:0o600});
 const wrongHost=spawnSync('ssh',wrongPlan.args,{timeout:5000,encoding:'utf8'});
 assert.equal(wrongHost.status,255);assert.match(wrongHost.stderr,/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/);
 const permitted=planAgentTunnel(config,options);
 const shellArgs=[];
 for(let i=0;i<permitted.args.length;i++){if(permitted.args[i]==='-N')continue;if(permitted.args[i]==='-R'){i++;continue;}shellArgs.push(permitted.args[i]);}
 const shell=spawnSync('ssh',[...shellArgs,'true'],{timeout:5000,encoding:'utf8'});
 assert.equal(shell.status,255,'Shell channels must be denied');
 await tunnel.stop();
 await assert.rejects(fetch(`http://127.0.0.1:${remotePort}`,{signal:AbortSignal.timeout(1000)}));
 worker=spawn(process.execPath,[new URL('../workbench/agent-remote-worker.mjs',import.meta.url).pathname,'--directory',root+'/device','--local-port',String(localPort)],{stdio:['pipe','pipe','pipe']});
 worker.stdout.resume();worker.stderr.resume();
 const workerExit=new Promise(resolve=>worker.once('exit',resolve));
 worker.stdin.write(JSON.stringify({...config,devicePublicKey:device.publicKey})+'\n');
 let workerReady=false;
 for(let i=0;i<30;i++){
  try{const r=await fetch(`http://127.0.0.1:${remotePort}/mcp`,{method:'POST',body:'{}',signal:AbortSignal.timeout(500)});if(r.status===401){workerReady=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(workerReady,true,'Owned worker must establish the restricted tunnel');
 worker.kill('SIGTERM');
 const deadline=setTimeout(()=>worker.kill('SIGKILL'),7000);
 try{assert.equal(await workerExit,0);}finally{clearTimeout(deadline);}
 await assert.rejects(fetch(`http://127.0.0.1:${remotePort}`,{signal:AbortSignal.timeout(1000)}));

}finally{
 if(worker&&worker.exitCode===null&&worker.signalCode===null){const stopped=new Promise(r=>worker.once('exit',r));worker.kill('SIGTERM');await stopped;}
 if(tunnel)await tunnel.stop();
 if(daemon&&daemon.exitCode===null&&daemon.signalCode===null){const stopped=new Promise(r=>daemon.once('exit',r));daemon.kill();await stopped;}
 transport.close();await rm(root,{recursive:true,force:true});
}

});
