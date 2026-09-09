import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../src-tauri/src/independent_welcome.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function screen(invoke){
 const elements=Object.fromEntries(['studio','existing','error'].map(id=>[id,{disabled:false,textContent:''}]));
 let reloads=0;
 vm.runInNewContext(script,{document:{getElementById:id=>elements[id]},window:{__TAURI__:{core:{invoke}}},location:{reload:()=>reloads++}});
 return {elements,reloads:()=>reloads};
}
test('cancelled folder selection stays on welcome and restores both choices',async()=>{
 const view=screen(async()=>false);
 await view.elements.existing.onclick();
 assert.equal(view.reloads(),0);
 assert.equal(view.elements.studio.disabled,false);
 assert.equal(view.elements.existing.disabled,false);
});
test('selection is single flight and only successful selection reloads',async()=>{
 let release;const calls=[];
 const view=screen(name=>{calls.push(name);return new Promise(resolve=>{release=resolve;});});
 const pending=view.elements.existing.onclick();
 assert.equal(view.elements.studio.disabled,true);
 await view.elements.studio.onclick();
 assert.deepEqual(calls,['medialab_select_installation']);
 release(true);await pending;assert.equal(view.reloads(),1);
});
test('failed validation allows retry and opening Studio never runs an installer',async()=>{
 const calls=[];
 const view=screen(async name=>{calls.push(name);if(name==='medialab_select_installation')throw Error('Installation is incomplete');});
 await view.elements.existing.onclick();
 assert.match(view.elements.error.textContent,/Installation is incomplete/);
 assert.equal(view.elements.existing.disabled,false);
 await view.elements.studio.onclick();
 assert.deepEqual(calls,['medialab_select_installation','medialab_not_now']);
 assert.equal(view.reloads(),0);
});
