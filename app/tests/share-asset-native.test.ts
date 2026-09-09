import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({create:vi.fn(),write:vi.fn(),available:vi.fn(),share:vi.fn(),name:''}));
vi.mock('expo-file-system',()=>({Paths:{cache:'cache'},Directory:class {create=f.create;},File:class {uri='file:///cache/export.wav';constructor(_folder:unknown,name:string){f.name=name;}write=f.write;}}));
vi.mock('expo-sharing',()=>({isAvailableAsync:f.available,shareAsync:f.share}));
import {shareAssetBytes} from '@/lib/share/share-asset-bytes';
beforeEach(()=>{vi.resetAllMocks();f.available.mockResolvedValue(true);});
it('writes exact bytes to cache and hands a sanitized filename and MIME type to the chooser',async()=>{
 const bytes=new Uint8Array([1,2,3]);await shareAssetBytes('../song.wav',bytes);
 expect(f.name).toBe('song.wav');expect(f.write).toHaveBeenCalledWith(bytes);
 expect(f.share).toHaveBeenCalledWith('file:///cache/export.wav',{mimeType:'audio/wav',dialogTitle:'Save or share your creation'});
});
it('does not create a partial export when sharing is unavailable and does not share failed writes',async()=>{
 f.available.mockResolvedValueOnce(false);await expect(shareAssetBytes('song.wav',new Uint8Array([1]))).rejects.toThrow('unavailable');expect(f.write).not.toHaveBeenCalled();
 f.write.mockImplementationOnce(()=>{throw Error('disk full');});await expect(shareAssetBytes('song.wav',new Uint8Array([1]))).rejects.toThrow('disk full');expect(f.share).not.toHaveBeenCalled();
});
