import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../src-tauri/src/independent_status.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function screen(invoke,onInterval=()=>{}){
 const elements=Object.fromEntries(['start','stop','status','error'].map(id=>[id,{disabled:true,textContent:''}]));
 vm.runInNewContext(script,{document:{getElementById:id=>elements[id]},window:{__TAURI__:{core:{invoke}}},setInterval:callback=>{onInterval(callback);return 0;}});
 return elements;
}
test('start and stop use existing controller and reflect process state',async()=>{
 let running=false;const calls=[];
 const elements=screen(async name=>{calls.push(name);if(name==='medialab_enable')running=true;if(name==='medialab_disable')running=false;return {medialab:{running,reason:running?null:'disabled'}};});
 await tick();assert.equal(elements.start.disabled,false);assert.equal(elements.stop.disabled,true);
 await elements.start.onclick();assert.equal(elements.start.disabled,true);assert.equal(elements.stop.disabled,false);
 assert.equal(elements.status.textContent,'Controller process is running.');
 await elements.stop.onclick();assert.equal(elements.start.disabled,false);assert.equal(elements.error.textContent,'');
 assert.ok(calls.includes('medialab_enable'));assert.ok(calls.includes('medialab_disable'));assert.ok(!calls.includes('show_pair_window'));
});
test('failed start stays visible and allows retry',async()=>{
 const elements=screen(async name=>{if(name==='medialab_enable')throw Error('Installed Python missing');return {medialab:{running:false,reason:'exited'}};});
 await tick();await elements.start.onclick();
 assert.match(elements.error.textContent,/Installed Python missing/);assert.equal(elements.start.disabled,false);assert.equal(elements.stop.disabled,true);
});

test('late status response cannot overwrite completed start',async()=>{
 let running=false,delay=false,release,poll;
 const elements=screen(async name=>{
  if(name==='medialab_enable')running=true;
  if(name==='sidecar_status'&&delay){delay=false;return await new Promise(resolve=>{release=()=>resolve({medialab:{running:false,reason:'disabled'}});});}
  return {medialab:{running,reason:null}};
 },callback=>{poll=callback;});
 await tick();delay=true;const old=poll();await tick();
 await elements.start.onclick();assert.equal(elements.status.textContent,'Controller process is running.');
 release();await old;
 assert.equal(elements.status.textContent,'Controller process is running.');
 assert.equal(elements.start.disabled,true);assert.equal(elements.stop.disabled,false);
});
