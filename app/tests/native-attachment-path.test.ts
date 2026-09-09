import {expect,it} from 'vitest';
import {iosProjectAttachmentPath,sameNativeProjectAttachment} from '../src/lib/storage/native-attachment-path';
import {encodeFileBackedSnapshot,decodeProjectSnapshot} from '../src/lib/sync/project-snapshot';
const old='file:///var/mobile/Containers/Data/Application/11111111-1111-1111-1111-111111111111/Documents/projects/p1/files/assets/image.png';
const current=old.replaceAll('11111111','22222222');
it('resolves a moved iOS container without changing the project-relative file',()=>{
 expect(iosProjectAttachmentPath(old,'p1')).toBe('files/assets/image.png');
 expect(sameNativeProjectAttachment(old,current,'p1')).toBe(true);
 expect(sameNativeProjectAttachment(old,current.replace('image.png','other.png'),'p1')).toBe(false);
 expect(sameNativeProjectAttachment(old,current,'p2')).toBe(false);
});
it('supports simulator relocation and percent-encoded names',()=>{
 const uri='file:///Users/test/Library/Developer/CoreSimulator/Devices/11111111-1111-1111-1111-111111111111/data/Containers/Data/Application/22222222-2222-2222-2222-222222222222/Documents/projects/p1/media/my%20image.png';
 expect(iosProjectAttachmentPath(uri,'p1')).toBe('media/my image.png');
});
it('does not reinterpret remote, arbitrary local, other-project, or traversal references',()=>{
 for(const uri of [old.replace('file:','https:'),old.replace('file:///','file://host/'),old.replace('/p1/','/p2/'),old+'?secret=1',old+'#fragment',old.replace('/assets/','/../assets/'),old.replace('/assets/','/%2e%2e/assets/'),'file:///tmp/Documents/projects/p1/files/assets/image.png'])expect(iosProjectAttachmentPath(uri,'p1')).toBeNull();
});
it('makes a relocated attachment portable only when its file is enumerated',()=>{
 const snapshot={meta:{id:'p1',name:'Test',description:'',emoji:'✨',createdAt:1,updatedAt:1},chat:[{id:'m1',role:'user' as const,text:'image',createdAt:1,attachments:[{kind:'image' as const,uri:old}]}],files:[{path:'assets/image.png',content:'AQID',encoding:'base64' as const}]};
 const raw=encodeFileBackedSnapshot(snapshot,()=>current);
 expect(decodeProjectSnapshot(raw).chat[0].attachments?.[0].uri).toBe('vibex-project-file:assets%2Fimage.png');
 expect(()=>encodeFileBackedSnapshot({...snapshot,files:[]},()=>current)).toThrow('not embedded');
});
