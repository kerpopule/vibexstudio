/** Native-owned remote connection worker. Enrollment is received only on stdin. */
import {connectAgentServer} from './agent-remote-connection.mjs';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--directory'||args[2]!=='--local-port'||!/^\d+$/.test(args[3])){
 process.stderr.write('Invalid remote worker request\n');process.exit(1);
}
let input='',started=false,closing=false,connection,initializing=Promise.resolve();
const emit=state=>{if(!process.stdout.destroyed)process.stdout.write(JSON.stringify(state)+'\n');};
async function close(){
 if(closing)return;closing=true;process.stdin.pause();
 try{await initializing;await connection?.stop();}catch{}
 process.exitCode=0;
}
process.on('SIGTERM',()=>void close());
process.stdin.on('end',()=>void close());
process.stdin.on('error',()=>void close());
process.stdout.on('error',()=>void close());
process.stdin.on('data',chunk=>{
 if(started||closing)return;
 input+=chunk.toString('utf8');
 if(Buffer.byteLength(input)>16384){emit({phase:'failed',error:'Enrollment is too large',verified:false});void close();return;}
 if(!input.includes('\n'))return;
 started=true;const encoded=input;input='';
 initializing=(async()=>{
  try{
   const enrollment=JSON.parse(encoded);
   if(closing)return;
   connection=await connectAgentServer(args[1],enrollment,Number(args[3]),{
    onState:state=>emit(state),
    // If the parent disconnects during key validation, no SSH child may start.
    beforeSpawn:()=>{if(closing)throw new Error('Desktop disconnected');},
   });
   if(closing){await connection.stop();return;}
   emit(connection.snapshot());
   void connection.finished.then(()=>{process.stdin.destroy();}).catch(()=>{emit({phase:'failed',error:'Connection cleanup failed',verified:false});process.stdin.destroy();});
  }catch{emit({phase:'failed',error:'Remote connection could not start. Check enrollment and this device’s identity.',verified:false});process.stdin.destroy();process.exitCode=1;}
 })();
});
