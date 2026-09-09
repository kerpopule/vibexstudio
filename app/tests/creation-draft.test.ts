import {beforeEach, expect, it} from 'vitest';
import {useCreationDraft} from '@/lib/creation-draft';

beforeEach(() => useCreationDraft.setState({task:'image',drafts:{
  image:{prompt:'',providerId:null},video:{prompt:'',providerId:null},
}}));

it('keeps distinct prompts and providers while switching through non-generation tasks', () => {
  const actions = useCreationDraft.getState();
  actions.setPrompt('image','A transparent character');
  actions.setProvider('image','image-creator');
  actions.setTask('video');
  actions.setPrompt('video','The character waves');
  actions.setProvider('video','video-creator');
  actions.setTask('audio');
  actions.setTask('game');
  actions.setTask('image');
  expect(useCreationDraft.getState().drafts).toEqual({
    image:{prompt:'A transparent character',providerId:'image-creator'},
    video:{prompt:'The character waves',providerId:'video-creator'},
  });
  actions.setPrompt('image','');
  expect(useCreationDraft.getState().drafts.video.prompt).toBe('The character waves');
});

it('retains a draft when screen subscribers leave and limits text to the composer maximum', () => {
  const unsubscribe = useCreationDraft.subscribe(() => {});
  useCreationDraft.getState().setPrompt('image','a'.repeat(5000));
  unsubscribe();
  expect(useCreationDraft.getState().drafts.image.prompt).toHaveLength(4000);
});

it('clears only the completed request, retaining newer prompts and provider changes',async()=>{
 const {clearCompletedCreationDraft}=await import('@/lib/creation-draft');
 useCreationDraft.getState().setPrompt('image','Original');
 useCreationDraft.getState().setProvider('image','provider-a');
 useCreationDraft.getState().setPrompt('image','New draft');
 clearCompletedCreationDraft('image','Original','provider-a');
 expect(useCreationDraft.getState().drafts.image.prompt).toBe('New draft');
 useCreationDraft.getState().setProvider('image','provider-b');
 clearCompletedCreationDraft('image','New draft','provider-a');
 expect(useCreationDraft.getState().drafts.image.prompt).toBe('New draft');
 clearCompletedCreationDraft('image','New draft','provider-b');
 expect(useCreationDraft.getState().drafts.image.prompt).toBe('');
});
