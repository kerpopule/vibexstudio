import {beforeEach,expect,it} from 'vitest';
import {useCreationDraft,persistCreationDraft} from '@/lib/creation-draft';
const reset=()=>useCreationDraft.setState({task:'image',storageError:false,drafts:{image:{prompt:'',providerId:null},video:{prompt:'',providerId:null}}});
beforeEach(reset);
it('restores separate prompts and task with the selected provider identity',async()=>{
 let raw:string|null=null;const storage={getItem:async()=>raw,setItem:async(_k:string,v:string)=>{raw=v;}};
 const first=await persistCreationDraft(storage,()=>{});
 useCreationDraft.getState().setPrompt('image','Sprite');useCreationDraft.getState().setPrompt('video','Victory scene');
 useCreationDraft.getState().setTask('video');useCreationDraft.getState().setProvider('video','private-provider');
 await first.flush();first.unsubscribe();expect(raw).toContain('private-provider');reset();
 const second=await persistCreationDraft(storage,()=>{});
 expect(useCreationDraft.getState()).toMatchObject({task:'video',drafts:{image:{prompt:'Sprite'},video:{prompt:'Victory scene',providerId:'private-provider'}}});second.unsubscribe();
});
it('keeps typing made during hydration while restoring the other draft',async()=>{
 let resolve!:(s:string)=>void;const binding=persistCreationDraft({getItem:()=>new Promise(r=>{resolve=r;}),setItem:async()=>{}},()=>{});
 useCreationDraft.getState().setPrompt('image','New');useCreationDraft.getState().setTask('game');
 resolve(JSON.stringify({task:'video',image:'Old',video:'Keep'}));const done=await binding;
 expect(useCreationDraft.getState()).toMatchObject({task:'game',drafts:{image:{prompt:'New'},video:{prompt:'Keep'}}});done.unsubscribe();
});
it('warns on storage failure without looping or discarding input',async()=>{
 let calls=0;const binding=await persistCreationDraft({getItem:async()=>null,setItem:async()=>{calls++;throw Error('Quota');}},()=>useCreationDraft.setState({storageError:true}));
 await binding.flush();expect(calls).toBe(1);
 useCreationDraft.getState().setPrompt('image','Keep editable');await binding.flush();
 expect(calls).toBe(2);expect(useCreationDraft.getState().drafts.image.prompt).toBe('Keep editable');binding.unsubscribe();
});

it('does not substitute another provider when a saved choice disappears',async()=>{
 const {selectedCreationProvider}=await import('@/lib/creation-draft');
 const providers=[{id:'first'},{id:'second'}];
 expect(selectedCreationProvider(providers,'second')).toBe(providers[1]);
 expect(selectedCreationProvider(providers,'removed')).toBeNull();
 expect(selectedCreationProvider(providers,null)).toBe(providers[0]);
 expect(selectedCreationProvider([],null)).toBeNull();
});
