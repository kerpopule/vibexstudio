import {expect,it} from 'vitest';
import {createStore} from 'zustand/vanilla';
import {persistComposer} from '@/lib/composer-persistence';
import {EMPTY_COMPOSER,type Composer} from '@/lib/project-composer';
const make=()=>createStore<{drafts:Record<string,Composer>}>(()=>({drafts:{}}));
it('restores draft text and mode but never a stale pending state',async()=>{
 let raw:string|null=null;
 const storage={getItem:async()=>raw,setItem:async(_k:string,v:string)=>{raw=v;}};
 const first=make();const a=await persistComposer(first,storage,()=>{});
 first.setState({drafts:{a:{text:'My video',mode:'video',pending:true,error:'old'}}});
 await a.flush();a.unsubscribe();
 const second=make();const b=await persistComposer(second,storage,()=>{});
 expect(second.getState().drafts.a).toEqual({text:'My video',mode:'video',pending:false,error:''});
 await b.flush();b.unsubscribe();
});
it('retains typing during hydration and restores other projects',async()=>{
 let resolve!:(v:string)=>void;const store=make();
 const setup=persistComposer(store,{getItem:()=>new Promise(r=>{resolve=r;}),setItem:async()=>{}},()=>{});
 store.setState({drafts:{a:{...EMPTY_COMPOSER,text:'New'}}});
 resolve(JSON.stringify({a:{text:'Old',mode:'image'},b:{text:'Keep',mode:'chat'},bad:{text:6}}));
 const binding=await setup;expect(store.getState().drafts.a.text).toBe('New');
 expect(store.getState().drafts.b.text).toBe('Keep');expect(store.getState().drafts.bad).toBeUndefined();binding.unsubscribe();
});
it('reports quota failure without retrying forever on error-state updates',async()=>{
 const store=make();let attempts=0;let errors=0;
 const binding=await persistComposer(store,{getItem:async()=>null,setItem:async()=>{attempts++;throw Error('Quota');}},()=>{errors++;store.setState({drafts:{...store.getState().drafts}});});
 await binding.flush();expect(attempts).toBe(1);expect(errors).toBe(1);
 store.setState({drafts:{a:{...EMPTY_COMPOSER,text:'Still editable'}}});
 await binding.flush();expect(attempts).toBe(2);expect(store.getState().drafts.a.text).toBe('Still editable');binding.unsubscribe();
});
it('writes removal after earlier saves so a restarted store cannot resurrect the prompt',async()=>{
 let raw:string|null=JSON.stringify({deleted:{text:'Remove this',mode:'video'},kept:{text:'Keep this',mode:'chat'}});
 const storage={getItem:async()=>raw,setItem:async(_key:string,value:string)=>{raw=value;}};
 const store=make();const binding=await persistComposer(store,storage,()=>{});
 const remaining={...store.getState().drafts};delete remaining.deleted;
 store.setState({drafts:remaining});await binding.flush();binding.unsubscribe();
 const restarted=make();const next=await persistComposer(restarted,storage,()=>{});
 expect(restarted.getState().drafts.deleted).toBeUndefined();
 expect(restarted.getState().drafts.kept.text).toBe('Keep this');next.unsubscribe();
});
