/** Native-owned identity entry point. Only the public key crosses stdout. */
import {access} from 'node:fs/promises';
import {deviceIdentity} from './agent-device-identity.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--directory'){
 process.stderr.write('Invalid enrollment request\n');process.exitCode=1;
}else{
 try{
  let create=false;
  try{await access(args[1]);}catch(error){if(error.code==='ENOENT')create=true;else throw error;}
  const identity=await deviceIdentity(args[1],{create});
  process.stdout.write(JSON.stringify({publicKey:identity.publicKey})+'\n');
 }catch{
  process.stderr.write('Could not prepare the private device identity. Existing files were preserved.\n');process.exitCode=1;
 }
}
