import {expect,it} from 'vitest';
import {decodeProjectSnapshot,encodeProjectSnapshot,materializeSnapshotChat} from '../src/lib/sync/project-snapshot';
import type {ProjectSnapshot} from '../src/lib/sync/project-snapshot';
function fixture():ProjectSnapshot {
 return {meta:{id:'audio-project',name:'Audio game',description:'',emoji:'🎵',createdAt:1,updatedAt:1},
  files:[{path:'assets/win.wav',encoding:'base64',content:'UklGRg=='}],
  chat:[{id:'audio-message',role:'user',text:'Use this sound when I win',createdAt:1,attachments:[{kind:'audio',uri:'data:audio/wav;base64,UklGRg=='}]}]};
}
it('preserves embedded audio in a portable snapshot and rebuilds its player URI',()=>{
 const snapshot=decodeProjectSnapshot(encodeProjectSnapshot(fixture()));
 expect(snapshot.chat[0].attachments?.[0]).toEqual({kind:'audio',uri:'vibex-project-file:assets%2Fwin.wav'});
 expect(materializeSnapshotChat(snapshot)[0].attachments?.[0]).toEqual({kind:'audio',uri:'data:audio/wav;base64,UklGRg=='});
 expect(materializeSnapshotChat(snapshot,path=>'file:///project/'+path)[0].attachments?.[0].uri).toBe('file:///project/assets/win.wav');
});
it('rejects remote audio and mismatched embedded media types',()=>{
 const remote=fixture();remote.chat[0].attachments![0].uri='https://example.com/audio.wav';
 expect(()=>encodeProjectSnapshot(remote)).toThrow('not embedded');
 const wrong=fixture();wrong.files[0].path='assets/win.png';wrong.chat[0].attachments![0].uri='vibex-project-file:assets%2Fwin.png';
 expect(()=>encodeProjectSnapshot(wrong)).toThrow('matching media');
});
