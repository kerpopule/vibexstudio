import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
function worker(){return spawn(process.execPath,[new URL('../workbench/agent-remote-worker.mjs',import.meta.url).pathname,'--directory','/nonexistent/vibex-test-identity','--local-port','53931'],{stdio:['pipe','pipe','pipe']});}
test('exits when parent disconnects before enrollment',async()=>{
 const child=worker();const exit=new Promise(resolve=>child.once('exit',resolve));child.stdin.end();assert.equal(await exit,0);
});
test('rejects malformed enrollment without spawning a tunnel',async()=>{
 const child=worker();let output='';child.stdout.on('data',b=>{output+=b;});const exit=new Promise(resolve=>child.once('exit',resolve));
 child.stdin.write('not-json\n');assert.equal(await exit,1);assert.equal(JSON.parse(output).phase,'failed');
});
