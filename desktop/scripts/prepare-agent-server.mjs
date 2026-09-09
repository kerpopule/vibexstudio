#!/usr/bin/env node
import {writeAgentServerEnrollment} from '../workbench/agent-server-enrollment.mjs';

// Public configuration only. Read from stdin so a caller need not shell-quote JSON.
try {
 const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--output')throw new Error('Usage: node desktop/scripts/prepare-agent-server.mjs --output /absolute/new-directory < configuration.json');
 let size=0;const chunks=[];
 for await(const chunk of process.stdin){size+=chunk.length;if(size>512*1024)throw new Error('Configuration exceeds 512 KiB');chunks.push(chunk);}
 let config;try{config=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('Provide a complete JSON configuration on stdin');}
 console.log(JSON.stringify(await writeAgentServerEnrollment(config,args[1])));
}catch(error){console.error(error.message);process.exitCode=1;}
