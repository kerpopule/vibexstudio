import {mkdir,readFile,lstat,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {validateAgentPublicKey} from './agent-ssh-plan.mjs';

function keygen(args){return new Promise((resolve,reject)=>{
 const child=spawn('ssh-keygen',args,{stdio:['ignore','pipe','pipe']});let output='';
 const timer=setTimeout(()=>child.kill('SIGKILL'),15_000);
 child.stdout.on('data',chunk=>{output+=chunk;if(output.length>8192)child.kill('SIGKILL');});
 // Discard diagnostics: never include private key material in errors or logs.
 child.stderr.resume();child.once('error',()=>{clearTimeout(timer);reject(new Error('OpenSSH key generation is unavailable'));});
 child.once('exit',code=>{clearTimeout(timer);if(code===0&&output.length<=8192)resolve(output);else reject(new Error('Could not verify or generate the device identity'));});
});}
async function privateFile(file){
 const stat=await lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw new Error('Device identity must be a private file owned by this user');
}
/** POSIX implementation. Windows needs an explicit per-user ACL implementation. */
export async function deviceIdentity(directory,{create=false}={}){
 if(process.platform==='win32')throw new Error('Device-key setup needs the Windows credential ACL implementation');
 if(!path.isAbsolute(directory))throw new Error('Device identity requires an absolute app-data path');
 const parent=await realpath(path.dirname(directory));directory=path.join(parent,path.basename(directory));
 if(create)await mkdir(directory,{mode:0o700});
 const stat=await lstat(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw new Error('Device identity directory must be private and owned by this user');
 const identityFile=path.join(directory,'identity');
 if(create)await keygen(['-q','-t','ed25519','-N','','-C','vibex-agent-device','-f',identityFile]);
 await privateFile(identityFile);
 const derived=validateAgentPublicKey((await keygen(['-y','-f',identityFile])).trim().split(/\s+/).slice(0,2).join(' '));
 const publicFile=path.join(directory,'identity.pub');const publicStat=await lstat(publicFile);
 if(!publicStat.isFile()||publicStat.isSymbolicLink()||publicStat.size>8192)throw new Error('Invalid device public key file');
 const published=(await readFile(publicFile,'utf8')).trim().split(/\s+/).slice(0,2).join(' ');
 if(validateAgentPublicKey(published)!==derived)throw new Error('Device public and private keys do not match');
 return {publicKey:derived,identityFile};
}
