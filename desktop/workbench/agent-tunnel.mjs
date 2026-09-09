import {spawn} from 'node:child_process';
import {planAgentTunnel} from './agent-ssh-plan.mjs';

/** Own one SSH process. Remote MCP acceptance is a separate enrollment step. */
export function startAgentTunnel(config,options,{spawnProcess=spawn,onState=()=>{},killAfterMs=5000}={}) {
 const plan=planAgentTunnel(config,options);
 let state={phase:'starting',remoteEndpoint:plan.remoteEndpoint,verified:false};
 let stopping=false,terminal=false,killTimer;
 const update=next=>{state={...state,...next};onState(state);};
 const child=spawnProcess(plan.executable,plan.args,{stdio:['ignore','ignore','pipe'],shell:false});
 // SSH may echo paths/account details; keep diagnostics out of user content.
 child.stderr?.resume();
 let resolveFinished;
 const finished=new Promise(resolve=>{resolveFinished=resolve;});
 const finish=(phase,code=null)=>{
  if(terminal)return;terminal=true;if(killTimer)clearTimeout(killTimer);
  update({phase,exitCode:code});resolveFinished(state);
 };
 child.once('spawn',()=>{if(!stopping&&!terminal)update({phase:'process-running'});});
 child.once('error',()=>finish(stopping?'stopped':'failed'));
 child.once('exit',(code)=>finish(stopping?'stopped':'failed',code));
 return {
  snapshot:()=>({...state}),finished,
  stop(){
   if(terminal||stopping)return finished;
   stopping=true;update({phase:'stopping'});
   child.kill('SIGTERM');
   if(!terminal){killTimer=setTimeout(()=>child.kill('SIGKILL'),killAfterMs);killTimer.unref?.();}
   return finished;
  },
 };
}
