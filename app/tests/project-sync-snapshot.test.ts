import {it,expect} from 'vitest';
import {encodeProjectSnapshot,decodeProjectSnapshot,materializeSnapshotChat,encodeFileBackedSnapshot} from '../src/lib/sync/project-snapshot';
const snapshot={meta:{id:'p1',name:'Test',description:'',emoji:'✨',createdAt:1,updatedAt:2,ai:{connectionId:'private-connection',model:'local'},github:{owner:'me',repo:'private',branch:'main',isPrivate:true}},chat:[{id:'m1',role:'user' as const,text:'Hello',createdAt:1}],files:[{path:'index.html',content:'hello'}]};
it('preserves project content without transferring device connection bindings',()=>{
 const encoded=encodeProjectSnapshot(snapshot);expect(encoded).not.toContain('private-connection');expect(encoded).not.toContain('github');
 const decoded=decodeProjectSnapshot(encoded);expect(decoded.files[0].content).toBe('hello');expect(decoded.chat).toEqual(snapshot.chat);expect(decoded.meta.ai).toBeUndefined();
 expect(encodeProjectSnapshot(decoded)).toBe(encoded);
});
it('rejects nonportable paths, duplicate paths and corrupt binary data',()=>{
 for(const files of [[{path:'/absolute',content:''}],[{path:'../escape',content:''}],[{path:'A',content:''},{path:'a',content:''}],[{path:'dir',content:''},{path:'dir/file',content:''}],[{path:'image.png',content:'not base64',encoding:'base64' as const}]])expect(()=>encodeProjectSnapshot({...snapshot,files})).toThrow();
});
it('does not silently discard local chat attachments',()=>{
 expect(()=>encodeProjectSnapshot({...snapshot,chat:[{...snapshot.chat[0],attachments:[{kind:'image',uri:'file:///local/image.png'}]}]})).toThrow('attachments');
});
it('rejects malformed identities and unsupported snapshot versions',()=>{
 expect(()=>encodeProjectSnapshot({...snapshot,meta:{...snapshot.meta,id:'../other'}})).toThrow();
 expect(()=>decodeProjectSnapshot('{"format":"vibex/project-snapshot","version":2}')).toThrow();
});

it('transfers embedded image and video references without device-specific URIs',()=>{
 const value={...snapshot,files:[{path:'assets/image.png',content:'aGVsbG8=',encoding:'base64' as const},{path:'assets/clip.mp4',content:'dmlkZW8=',encoding:'base64' as const}],chat:[{...snapshot.chat[0],attachments:[{kind:'image' as const,uri:'data:image/png;base64,aGVsbG8=',prompt:'test'},{kind:'video' as const,uri:'vibex-idb://p1/files/assets/clip.mp4'}]}]};
 const raw=encodeProjectSnapshot(value);expect(raw).not.toContain('data:image');expect(raw).not.toContain('vibex-idb');
 const decoded=decodeProjectSnapshot(raw);expect(decoded.chat[0].attachments?.[0].uri).toBe('vibex-project-file:assets%2Fimage.png');
 const chat=materializeSnapshotChat(decoded);expect(chat[0].attachments?.[0]).toEqual(value.chat[0].attachments[0]);
 expect(chat[0].attachments?.[1].uri).toBe('data:video/mp4;base64,dmlkZW8=');
 expect(encodeProjectSnapshot({...decoded,chat})).toBe(raw);
 decoded.meta.id='conflict-copy';expect(materializeSnapshotChat(decoded)[0].attachments?.[0].uri).toBe(value.chat[0].attachments[0].uri);
});
it('rejects external attachment URLs and mismatched portable media types',()=>{
 for(const uri of ['https://example.test/private.png','vibex-idb://other/files/image.png','vibex-project-file:missing.png'])expect(()=>encodeProjectSnapshot({...snapshot,chat:[{...snapshot.chat[0],attachments:[{kind:'image',uri}]}]})).toThrow();
 const value={...snapshot,files:[{path:'clip.mp4',content:'dmlkZW8=',encoding:'base64' as const}],chat:[{...snapshot.chat[0],attachments:[{kind:'image' as const,uri:'vibex-project-file:clip.mp4'}]}]};
 expect(()=>encodeProjectSnapshot(value)).toThrow('matching media');
});

it('round trips native image and video paths without embedding repeated data URLs',()=>{
 const uri=(path:string)=>`file:///device/projects/p1/files/${path}`;
 const value={...snapshot,files:[{path:'image.png',content:'aGVsbG8=',encoding:'base64' as const},{path:'clip.mp4',content:'dmlkZW8=',encoding:'base64' as const}],chat:[{...snapshot.chat[0],attachments:[{kind:'image' as const,uri:uri('image.png')},{kind:'video' as const,uri:uri('clip.mp4')}]}]};
 const raw=encodeFileBackedSnapshot(value,uri);
 expect(raw).not.toContain('file:///');
 const decoded=decodeProjectSnapshot(raw);
 expect(materializeSnapshotChat(decoded,uri)).toEqual(value.chat);
 expect(encodeFileBackedSnapshot({...decoded,chat:materializeSnapshotChat(decoded,uri)},uri)).toBe(raw);
 value.chat[0].attachments[0].uri='file:///device/projects/other/files/image.png';
 expect(()=>encodeFileBackedSnapshot(value,uri)).toThrow('attachments');
});
