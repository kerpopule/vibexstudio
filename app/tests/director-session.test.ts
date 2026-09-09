import {beforeEach,expect,it} from 'vitest';
import {directorSessionKey,useDirectorSession} from '@/lib/director-session';
beforeEach(()=>useDirectorSession.setState({conversations:{},pending:{},forgotten:new Set()}));
it('shares project drafts between screens while isolating project and server contexts',()=>{
 const key=directorSessionKey('https://server','game');
 useDirectorSession.getState().setDraft(key,'Use my sprite');
 expect(useDirectorSession.getState().conversations[directorSessionKey('https://server','game')].draft).toBe('Use my sprite');
 expect(useDirectorSession.getState().conversations[directorSessionKey('https://other','game')]).toBeUndefined();
 expect(useDirectorSession.getState().conversations[directorSessionKey('https://server',undefined)]).toBeUndefined();
});
it('keeps newer draft edits when a previous request completes and bounds conversation history',()=>{
 const key=directorSessionKey('server','game');
 useDirectorSession.getState().setDraft(key,'Next question');
 useDirectorSession.getState().complete(key,'Previous question',Array.from({length:22},(_,i)=>({role:'user',content:String(i)})));
 expect(useDirectorSession.getState().conversations[key].draft).toBe('Next question');
 expect(useDirectorSession.getState().conversations[key].messages).toHaveLength(20);
 useDirectorSession.getState().complete(key,'Next question',[{role:'assistant',content:'Answer'}]);
 expect(useDirectorSession.getState().conversations[key].draft).toBe('');
});

it('serializes requests per conversation and ignores stale completion releases',()=>{
 const store=useDirectorSession.getState();
 const first=store.begin('project');expect(first).not.toBeNull();
 expect(store.begin('project')).toBeNull();
 expect(store.begin('different-project')).not.toBeNull();
 store.end('project',first!);
 const second=store.begin('project');expect(second).not.toBeNull();
 store.end('project',first!);
 expect(store.begin('project')).toBeNull();
 store.end('project',second!);
 expect(store.begin('project')).not.toBeNull();
});

it('clears idle conversations and prevents deleted project callbacks from recreating history',()=>{
 const store=useDirectorSession.getState(),key=directorSessionKey('server','deleted');
 store.setDraft(key,'A plan');const ticket=store.begin(key)!;
 store.clear(key);expect(useDirectorSession.getState().conversations[key].draft).toBe('A plan');
 store.end(key,ticket);store.clear(key);expect(useDirectorSession.getState().conversations[key]).toEqual({draft:'',messages:[]});
 store.setDraft(key,'Private draft');store.forgetProject('deleted');
 store.complete(key,'Private draft',[{role:'assistant',content:'Late answer'}]);store.setDraft(key,'Late edit');
 expect(store.begin(key)).toBeNull();expect(useDirectorSession.getState().conversations[key]).toBeUndefined();
});
