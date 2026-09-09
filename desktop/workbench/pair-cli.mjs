#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** Owner terminal interface; owner credentials never appear in output or arguments. */
export async function managePairing(configPath,command,args=[]){
 const config=JSON.parse(await fs.readFile(configPath,'utf8'));
 const port=config.port??8794;if(!Number.isInteger(port)||port<1||port>65535||typeof config.token!=='string')throw new Error('Invalid local server configuration.');
 let route,body;
 if(command==='invite'){
  const address=new URL(args[0]);
  if(!['http:','https:'].includes(address.protocol)||address.username||address.password||address.search||address.hash||address.pathname!=='/')throw new Error('Use the reachable server origin, such as https://studio.example.com.');
  route='/pairing/invites';body={};
 }else if(command==='devices'){route='/pairing/devices';}
 else if(command==='revoke'&&/^[0-9a-f-]{36}$/.test(args[0]??'')){route='/pairing/revoke';body={deviceId:args[0]};}
 else throw new Error('Use invite <server-origin>, devices, or revoke <device-id>.');
 const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{'X-Workbench-Token':config.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw new Error(`Server refused the pairing request (${response.status}). Check that it is running and up to date.`);
 const value=await response.json();
 if(command!=='invite')return value;
 if(typeof value.code!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.code))throw new Error('Invalid invitation response.');
 const link=new URL('vibex://pair');link.searchParams.set('workbench',new URL(args[0]).origin);link.searchParams.set('wbi',value.code);
 return {pairLink:link.toString(),expiresAt:value.expiresAt};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const config=process.env.WORKBENCH_CONFIG??fileURLToPath(new URL('./workbench.json',import.meta.url));console.log(JSON.stringify(await managePairing(config,process.argv[2],process.argv.slice(3)),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
