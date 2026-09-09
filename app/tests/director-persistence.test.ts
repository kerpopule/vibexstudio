import {expect,it} from 'vitest';
import {createStore} from 'zustand/vanilla';
import {persistDirector} from '@/lib/director-persistence';
import type {Conversation} from '@/lib/director-session';
const prefix='vibex.director.v1:';
const chat=(draft:string):Conversation=>({draft,messages:[{role:'assistant',content:'Use the existing character and song.'}]});
function fixture(){
 const values=new Map<string,string>();
 const storage={getAllKeys:async()=>[...values.keys()],getItem:async(k:string)=>values.get(k)??null,
  setItem:async(k:string,v:string)=>{values.set(k,v);},removeItem:async(k:string)=>{values.delete(k);}};
 const store=createStore(()=>({conversations:{} as Record<string,Conversation>,pending:{}}));
 const errors:boolean[]=[];return {values,storage,store,errors};
}
it('restores isolated conversations across restart, saving only chat content',async()=>{
 const {values,storage,store,errors}=fixture();values.set('unrelated-secret','leave alone');
 const binding=await persistDirector(store,storage,e=>errors.push(e));
 store.setState({conversations:{projectA:chat('Make a video'),projectB:chat('Make a game')},pending:{projectA:123}});
 await binding.flush();binding.unsubscribe();
 expect([...values.keys()].sort()).toEqual(['unrelated-secret',prefix+'projectA',prefix+'projectB'].sort());
 expect(values.get(prefix+'projectA')).not.toContain('pending');
 const restarted=fixture().store;
 const restored=await persistDirector(restarted,storage,e=>errors.push(e));await restored.flush();
 expect(restarted.getState().conversations).toEqual(store.getState().conversations);
 expect(restarted.getState().pending).toEqual({});expect(errors).not.toContain(true);restored.unsubscribe();
});
it('keeps edits during hydration and serializes clear and delete after queued writes',async()=>{
 const {values,storage,store}=fixture();values.set(prefix+'a',JSON.stringify(chat('Old draft')));
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const pending=persistDirector(store,{...storage,getAllKeys:async()=>{await gate;return [...values.keys()];}},()=>{});
 store.setState({conversations:{a:{draft:'New draft',messages:[]}}});release();const binding=await pending;await binding.flush();
 expect(store.getState().conversations.a).toEqual(chat('New draft'));
 store.setState({conversations:{a:{draft:'',messages:[]}}});await binding.flush();
 expect(JSON.parse(values.get(prefix+'a')!)).toEqual({draft:'',messages:[]});
 store.setState({conversations:{a:chat('Another edit')}});store.setState({conversations:{}});await binding.flush();
 expect(values.has(prefix+'a')).toBe(false);binding.unsubscribe();
});
it('reports failures, retains memory, and retries on the next edit',async()=>{
 const {values,storage,store,errors}=fixture();let fail=true;
 const binding=await persistDirector(store,{...storage,setItem:async(k,v)=>{if(fail)throw Error('Disk full');await storage.setItem(k,v);}},e=>errors.push(e));
 store.setState({conversations:{a:chat('Keep my draft')}});await binding.flush();expect(errors.at(-1)).toBe(true);
 expect(store.getState().conversations.a.draft).toBe('Keep my draft');
 fail=false;store.setState({conversations:{...store.getState().conversations,b:chat('Next')}});await binding.flush();
 expect(JSON.parse(values.get(prefix+'a')!).draft).toBe('Keep my draft');expect(errors.at(-1)).toBe(false);binding.unsubscribe();
});
it('retains corrupt records for recovery while loading valid histories',async()=>{
 const {values,storage,store,errors}=fixture();values.set(prefix+'bad','{broken');values.set(prefix+'good',JSON.stringify(chat('Keep')));
 const binding=await persistDirector(store,storage,e=>errors.push(e));await binding.flush();
 expect(values.get(prefix+'bad')).toBe('{broken');expect(store.getState().conversations.good.draft).toBe('Keep');
 expect(errors.at(-1)).toBe(true);binding.unsubscribe();
});
