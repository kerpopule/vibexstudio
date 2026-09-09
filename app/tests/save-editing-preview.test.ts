import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
const mocks=vi.hoisted(()=>({read:vi.fn(),save:vi.fn(),download:vi.fn()}));
vi.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:async(_:string,s:string)=>createHash('sha256').update(s).digest('hex')}));
vi.mock('@/lib/storage/media-gallery',()=>({readGalleryItem:mocks.read,saveEditedVideo:mocks.save}));
vi.mock('@/lib/remote-editing',()=>({readEditingPreview:mocks.download}));
import {saveEditingPreview} from '@/lib/save-editing-preview';
const receipt={projectId:'cut-test',revision:2,sha256:'a'.repeat(64),bytes:3,seconds:1,mimeType:'video/mp4' as const,candidate:true as const};
afterEach(()=>vi.resetAllMocks());
it('coalesces concurrent saves and reuses committed items without another download',async()=>{
 let stored:any=null;mocks.read.mockImplementation(async()=>stored);
 mocks.download.mockResolvedValue(new Uint8Array([1,2,3]));
 mocks.save.mockImplementation(async(prompt,bytes,id)=>stored={id,prompt,kind:'video'});
 const [one,two]=await Promise.all([saveEditingPreview('https://example.com',receipt,'My edit'),saveEditingPreview('https://example.com',receipt,'My edit')]);
 expect(one).toEqual(two);expect(mocks.download).toHaveBeenCalledTimes(1);expect(mocks.save).toHaveBeenCalledTimes(1);
 expect(one.prompt).toBe('My edit · revision 2 preview');
 expect(await saveEditingPreview('https://example.com',receipt,'My edit')).toEqual(one);
 expect(mocks.download).toHaveBeenCalledTimes(1);
});
it('retries failed storage with the same identity and separates hosts and revisions',async()=>{
 mocks.read.mockResolvedValue(null);mocks.download.mockResolvedValue(new Uint8Array([1,2,3]));
 mocks.save.mockRejectedValueOnce(new Error('Storage full')).mockImplementation(async(prompt,bytes,id)=>({id,prompt}));
 await expect(saveEditingPreview('https://example.com',receipt,'Edit')).rejects.toThrow('Storage full');
 const retry=await saveEditingPreview('https://example.com',receipt,'Edit');
 expect(mocks.save.mock.calls[0][2]).toBe(retry.id);
 const next=await saveEditingPreview('https://example.com',{...receipt,revision:3},'Edit');
 const remote=await saveEditingPreview('https://other.example.com',receipt,'Edit');
 expect(new Set([retry.id,next.id,remote.id]).size).toBe(3);
});
