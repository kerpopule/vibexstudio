import {beforeEach,expect,it} from 'vitest';
import {useProjectComposer} from '@/lib/project-composer';
beforeEach(()=>useProjectComposer.setState({drafts:{}}));
it('retains each project draft and mode across consumers without leaking to another project',()=>{
 useProjectComposer.getState().patch('a',{text:'Make a sprite',mode:'image'});
 useProjectComposer.getState().patch('b',{text:'Make a game'});
 expect(useProjectComposer.getState().drafts.a).toMatchObject({text:'Make a sprite',mode:'image'});
 expect(useProjectComposer.getState().drafts.b).toMatchObject({text:'Make a game',mode:'chat'});
});
it('guards duplicate submissions after remount and retains late recovery for the original project',()=>{
 expect(useProjectComposer.getState().begin('a')).toBe(true);
 expect(useProjectComposer.getState().begin('a')).toBe(false);
 expect(useProjectComposer.getState().begin('b')).toBe(true);
 useProjectComposer.getState().patch('a',{text:'Recovered request',mode:'video',error:'Connection failed',pending:false});
 expect(useProjectComposer.getState().drafts.a).toMatchObject({text:'Recovered request',mode:'video',error:'Connection failed',pending:false});
 expect(useProjectComposer.getState().drafts.b.pending).toBe(true);
 expect(useProjectComposer.getState().begin('a')).toBe(true);
 expect(useProjectComposer.getState().drafts.a.error).toBe('');
});
it('forgets a deleted project and refuses late send callbacks that would restore its draft',()=>{
 const store=useProjectComposer.getState();
 store.patch('deleted-project',{text:'Private unfinished prompt',mode:'video'});
 store.patch('retained-project',{text:'Keep this'});
 store.forget('deleted-project');
 store.patch('deleted-project',{text:'Late recovery',pending:false});
 expect(useProjectComposer.getState().drafts['deleted-project']).toBeUndefined();
 expect(store.begin('deleted-project')).toBe(false);
 expect(useProjectComposer.getState().drafts['retained-project'].text).toBe('Keep this');
});

it('prepares an editable chat proposal without submitting or replacing existing drafts',()=>{
 const store=useProjectComposer.getState();
 expect(store.propose('proposal','Use this plan')).toBe(true);
 expect(useProjectComposer.getState().drafts.proposal).toMatchObject({text:'Use this plan',mode:'chat',pending:false});
 expect(store.propose('proposal','Replace it')).toBe(false);
 expect(useProjectComposer.getState().drafts.proposal.text).toBe('Use this plan');
 store.patch('busy-proposal',{pending:true});
 expect(store.propose('busy-proposal','Another request')).toBe(false);
 store.forget('removed-proposal');
 expect(store.propose('removed-proposal','Restore')).toBe(false);
 expect(store.propose('empty-proposal','  ')).toBe(false);
});
