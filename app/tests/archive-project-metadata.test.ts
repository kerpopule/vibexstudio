import {it,expect,vi} from 'vitest';
import {archivedAttachmentPath,prepareArchivedProjectMetadata} from '../src/lib/share/archive-project-metadata';
const meta={id:'original',name:'Film',description:'',emoji:'',createdAt:1,updatedAt:2,ai:{connectionId:'private'},github:{repo:'private'},unknown:'discard'};
it('restores fresh identity and resolves every attachment without carrying account links',async()=>{
 const resolve=vi.fn(async()=> 'data:video/mp4;base64,AQID');
 const result=await prepareArchivedProjectMetadata(meta,[{id:'m1',role:'user',text:'Use it',createdAt:1,attachments:[{kind:'video',uri:'vibex-idb://original/files/assets/win.mp4',prompt:'intro',extra:'discard'}]}],'fresh',resolve);
 expect(result.meta).toEqual({id:'fresh',name:'Film (restored)',description:'',emoji:'',createdAt:1,updatedAt:2});
 expect(result.chat[0].attachments).toEqual([{kind:'video',uri:'data:video/mp4;base64,AQID',prompt:'intro'}]);
 expect(resolve).toHaveBeenCalledOnce();
 await expect(prepareArchivedProjectMetadata(meta,[],'original',resolve)).rejects.toThrow('fresh');
});
it('maps archived paths across native container changes and rejects outside/traversal URLs',()=>{
 expect(archivedAttachmentPath('vibex-project-file:assets%2Fwin.mp4','original')).toBe('files/assets/win.mp4');
 expect(archivedAttachmentPath('file:///old/container/projects/original/media/song.wav','original')).toBe('media/song.wav');
 expect(archivedAttachmentPath('vibex-idb://original/files/assets/win.mp4','original')).toBe('files/assets/win.mp4');
 for(const uri of ['https://example.com/private','file://remote/projects/original/files/x','file:///projects/original/files/../outside','vibex-idb://other/files/x','vibex-project-file:..%2Foutside'])expect(archivedAttachmentPath(uri,'original')).toBeNull();
});
it('fails the whole preparation when an attachment cannot be resolved',async()=>{
 const resolve=vi.fn(async()=>{throw new Error('Missing archived media');});
 await expect(prepareArchivedProjectMetadata(meta,[{id:'m1',role:'user',text:'',createdAt:1,attachments:[{kind:'image',uri:'blob:expired'}]}],'fresh',resolve)).rejects.toThrow('Missing');
});
