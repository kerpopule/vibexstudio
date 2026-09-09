#!/usr/bin/env node
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';

/** Creates a separate user-owned server folder; never overwrites an installation. */
export async function prepareWorkbench({output,port=8794,syncFolder,origins=[]}){
 if(!path.isAbsolute(output??'')||!Number.isInteger(port)||port<1||port>65535)throw new Error('Choose an absolute output folder and a port from 1 to 65535.');
 if(!Array.isArray(origins)||origins.length>20||origins.some(origin=>{try{const u=new URL(origin);return !['http:','https:'].includes(u.protocol)||u.origin!==origin||!!u.username||!!u.password;}catch{return true;}}))throw new Error('Choose exact HTTP(S) app origins.');
 if(syncFolder){const info=await fs.lstat(syncFolder);if(!path.isAbsolute(syncFolder)||!info.isDirectory()||info.isSymbolicLink())throw new Error('Choose an existing absolute project storage folder.');}
 try{await fs.lstat(output);throw new Error('Output folder already exists. Choose a new folder.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.mkdir(output,{mode:0o700});
 for(const name of ['server.mjs','project-sync-folder.mjs','device-pairing.mjs','pair-cli.mjs'])await fs.copyFile(fileURLToPath(new URL('../workbench/'+name,import.meta.url)),path.join(output,name));
 const config={enabled:true,port,token:crypto.randomBytes(32).toString('base64url'),projectsRoot:path.join(output,'projects'),syncOrigins:origins,...(syncFolder?{syncFolder}:{})};
 await fs.writeFile(path.join(output,'workbench.json'),JSON.stringify(config,null,2),{mode:0o600,flag:'wx'});
 await fs.writeFile(path.join(output,'run.mjs'),"import {fileURLToPath} from 'node:url';\nprocess.env.WORKBENCH_CONFIG=fileURLToPath(new URL('./workbench.json',import.meta.url));\ndelete process.env.WORKBENCH_PARENT_PID;\nawait import('./server.mjs');\n",{flag:'wx'});
 await fs.writeFile(path.join(output,'README.md'),'# Your Studio server\n\nRequires Node.js 18 or later. From this folder, run `node run.mjs`. It runs on this computer independently of the desktop app. To stay available after logout or reboot, run that command with your operating system’s service manager.\n\nCreate a five-minute device invitation with `node pair-cli.mjs invite <server-origin>`. Use an address your device can reach, such as your Tailscale address or your own HTTPS domain. List connections with `node pair-cli.mjs devices`; remove one with `node pair-cli.mjs revoke <device-id>`. Invitations grant build and shared-project access.\n\nKeep workbench.json private: it contains the owner credential. Project sync stays off unless you chose a storage folder. Files, device records, and build jobs stay on this server; no VibeX-operated storage is used. Use your own authenticated encrypted network path for remote access. The server listens on all IPv4 interfaces. Do not expose its port publicly without suitable network controls and HTTPS.\n',{flag:'wx'});
 return {directory:output,port,syncEnabled:!!syncFolder};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2),options={origins:[]};for(let i=0;i<args.length;i+=2){if(!args[i+1])throw new Error('Missing option value.');if(args[i]==='--output')options.output=args[i+1];else if(args[i]==='--port')options.port=Number(args[i+1]);else if(args[i]==='--sync-folder')options.syncFolder=args[i+1];else if(args[i]==='--origin')options.origins.push(args[i+1]);else throw new Error('Unknown option. Use --output, --port, --sync-folder, or --origin.');}console.log(JSON.stringify(await prepareWorkbench(options),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
