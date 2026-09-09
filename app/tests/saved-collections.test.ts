import {it,expect} from 'vitest';
import {parseSavedCollection,collectionIssueMessage,savedSceneDuration} from '../src/lib/saved-collections';

it('recovers decimal seconds from older forms without guessing missing or malformed timing',()=>{
 for(const value of [5,'5',' 5.0 '])expect(savedSceneDuration(value)).toBe(5);
 expect(savedSceneDuration('4.128')).toBe(4.128);
 for(const value of [undefined,null,'',' ','5 seconds','0x10','1e3',true,0,-1,'-1',Infinity,'Infinity','NaN'])expect(savedSceneDuration(value)).toBeUndefined();
 const record=parseSavedCollection({version:1,collection:'storyboards',records:[{id:'legacy',beats:[{duration:'5'},{duration:'4.128'},{}]}]},'storyboards')[0];
 expect(record.beats.map(beat=>beat.duration)).toEqual([5,4.128,undefined]);
});
it('preserves saved identities and readable character details',()=>{
  const result=parseSavedCollection({version:1,collection:'characters',records:[{id:'old-id',name:'Person',appearance:'Blue coat',voice_id:'voice'}]},'characters');
  expect(result[0]).toMatchObject({id:'old-id',title:'Person',description:'Blue coat'});
});
it('keeps storyboard scenes in their original order',()=>{
  const result=parseSavedCollection({version:1,collection:'storyboards',records:[{id:'board',title:'Film',beats:[{title:'Opening',description:'Arrive'},{title:'Ending',narration:'Goodbye'}]}]},'storyboards');
  expect(result[0].beats).toEqual([{title:'Opening',description:'Arrive',mediaLinks:[]},{title:'Ending',description:'Goodbye',mediaLinks:[]}]);
});
it('rejects duplicate identities and the wrong collection',()=>{
  expect(()=>parseSavedCollection({version:1,collection:'voices',records:[{id:'same'},{id:'same'}]},'voices')).toThrow('duplicate');
  expect(()=>parseSavedCollection({version:1,collection:'voices',records:[]},'characters')).toThrow('unsupported');
});
it('retains usable media IDs without exposing arbitrary URLs as assets',()=>{
 const result=parseSavedCollection({version:1,collection:'characters',records:[{id:'character',libraryAssets:[{id:'original-image',kind:'image',title:'Reference',url:'private'},{id:'../private',kind:'image'}]}]},'characters');
 expect(result[0].libraryAssets).toEqual([{id:'original-image',kind:'image',title:'Reference'}]);
});
it('preserves recovery IDs and reports missing links without choosing replacements',async()=>{
 const {collectionIssueMessage}=await import('../src/lib/saved-collections');
 const row=parseSavedCollection({version:1,collection:'voices',records:[{id:'voice',character_id:'missing',relationshipIssues:[{field:'character_id',targetId:'missing',reason:'target_not_in_preserved_collection'},null,{field:4}]}]},'voices')[0];
 expect(row.links?.characterId).toBe('missing');
 expect(row.relationshipIssues).toEqual([{field:'character_id',targetId:'missing',reason:'target_not_in_preserved_collection'}]);
 expect(collectionIssueMessage(row.relationshipIssues![0])).toContain('no replacement was chosen');
});
it('retains archived status without treating text flags as archived',()=>{
 const rows=parseSavedCollection({version:1,collection:'characters',records:[{id:'old',name:'Older character',archived:true},{id:'current',name:'Current',archived:'true'}]},'characters');
 expect(rows[0].archived).toBe(true);expect(rows[1].archived).toBe(false);
 expect(collectionIssueMessage({field:'refs/0',targetId:'/media/missing.png',reason:'archived_reference_file_missing'})).toContain('archived reference image');
});

it('keeps scene media roles and durations while rejecting arbitrary paths',()=>{
 const value=parseSavedCollection({version:1,collection:'storyboards',records:[{id:'board',beats:[{title:'Scene',duration:5,mediaLinks:[{field:'clip_url',id:'clip',kind:'video',title:'Shot',url:'private'},{field:'still_url',id:'../private',kind:'image'},{field:'unknown',id:'other',kind:'image'}]},{duration:Infinity}]}]},'storyboards')[0];
 expect(value.beats[0]).toMatchObject({duration:5,mediaLinks:[{field:'clip_url',id:'clip',kind:'video',title:'Shot'}]});
 expect(value.beats[1].duration).toBeUndefined();
 expect(JSON.stringify(value)).not.toContain('private');
});
