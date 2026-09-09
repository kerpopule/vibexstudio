import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAgentTransport} from '../workbench/agent-transport.mjs';
async function harness(dispatch,options) {
 const transport=createAgentTransport(dispatch,options);
 await new Promise(resolve=>transport.server.listen(0,'127.0.0.1',resolve));
 return {transport,url:`http://127.0.0.1:${transport.server.address().port}`};
}
test('passes bounded requests to owner and returns owner response without forwarding extra headers',async()=>{
 let owner;
 const {transport,url}=await harness(message=>{owner=message;transport.reply(message.id,{status:200,body:'{"ok":true}',headers:{'Set-Cookie':'no'}});});
 try {
 const response=await fetch(url+'/mcp',{method:'POST',headers:{Authorization:'Bearer fixture'},body:'{}'});
 assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);assert.deepEqual(await response.json(),{ok:true});
 assert.equal(owner.request.headers.authorization,'Bearer fixture');assert.equal(owner.request.body,'{}');
 }finally{transport.close();}
});
test('rejects browser origins, oversized bodies, and unsupported routes before dispatch',async()=>{
 let calls=0;const {transport,url}=await harness(()=>calls++);
 try {
 assert.equal((await fetch(url+'/mcp',{method:'POST',headers:{Origin:'https://example.org'},body:'{}'})).status,403);
 assert.equal((await fetch(url+'/mcp',{method:'POST',body:'x'.repeat(256*1024+1)})).status,413);
 assert.equal((await fetch(url+'/other',{method:'POST'})).status,404);assert.equal(calls,0);
 }finally{transport.close();}
});
test('times out an unavailable owner and bounds concurrent work',async()=>{
 let received;const ready=new Promise(resolve=>received=resolve);
 const {transport,url}=await harness(()=>received(),{timeoutMs:100,maxPending:1});
 try {
 const first=fetch(url+'/pair',{method:'POST',body:'{}'});await ready;
 assert.equal((await fetch(url+'/mcp',{method:'POST',body:'{}'})).status,429);
 assert.equal((await first).status,504);
 }finally{transport.close();}
});
test('actual child uses IPC and exits when its parent pipe closes',async()=>{
 const {spawn}=await import('node:child_process');const {createInterface}=await import('node:readline');
 const child=spawn(process.execPath,[new URL('../workbench/agent-transport.mjs',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:child.stdout});const iterator=lines[Symbol.asyncIterator]();
 const exited=new Promise(resolve=>child.once('exit',(code)=>resolve(code)));
 let watchdog=setTimeout(()=>child.kill(),5000);
 try {
 const ready=JSON.parse((await iterator.next()).value);assert.equal(ready.type,'ready');
 const result=fetch(`http://127.0.0.1:${ready.port}/pair`,{method:'POST',body:'{"code":"fixture"}'});
 const message=JSON.parse((await iterator.next()).value);assert.equal(message.type,'request');assert.equal(message.request.path,'/pair');
 child.stdin.write(JSON.stringify({id:message.id,response:{status:403,body:'{"error":"declined"}'}})+'\n');
 assert.equal((await result).status,403);
 child.stdin.end();assert.equal(await exited,0);
 }finally{clearTimeout(watchdog);child.kill();lines.close();}
});
test('reuses a requested port and refuses to move when it is occupied',async()=>{
 const {spawn}=await import('node:child_process');const {createInterface}=await import('node:readline');
 async function launch(port){
  const child=spawn(process.execPath,[new URL('../workbench/agent-transport.mjs',import.meta.url).pathname,'--port',String(port)],{stdio:['pipe','pipe','pipe']});
  const exited=new Promise(resolve=>child.once('exit',resolve));
  const lines=createInterface({input:child.stdout});
  const timeout=setTimeout(()=>child.kill(),5000);
  return {child,exited,lines,timeout};
 }
 const first=await launch(0);let port;
 try {port=JSON.parse((await first.lines[Symbol.asyncIterator]().next()).value).port;first.child.stdin.end();assert.equal(await first.exited,0);}
 finally{clearTimeout(first.timeout);first.child.kill();first.lines.close();}
 const second=await launch(port);
 try {
  assert.equal(JSON.parse((await second.lines[Symbol.asyncIterator]().next()).value).port,port);
  const conflict=await launch(port);
  try{assert.equal(await conflict.exited,1);}finally{clearTimeout(conflict.timeout);conflict.child.kill();conflict.lines.close();}
  second.child.stdin.end();assert.equal(await second.exited,0);
 }finally{clearTimeout(second.timeout);second.child.kill();second.lines.close();}
});
