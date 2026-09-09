import {afterEach,expect,it,vi} from 'vitest';
import {exportFileName} from '@/lib/share/export-file';
import {shareAssetBytes} from '@/lib/share/share-asset-bytes.web';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
it('preserves supported audio/model extensions while removing paths and unsafe characters',()=>{
 expect(exportFileName('../My song.wav')).toEqual({name:'My song.wav',mimeType:'audio/wav'});
 expect(exportFileName('character.GLB')).toEqual({name:'character.glb',mimeType:'model/gltf-binary'});
 expect(exportFileName('clip.mkv').mimeType).toBe('video/x-matroska');
 expect(()=>exportFileName('program.exe')).toThrow('file type');
 expect(exportFileName('a'.repeat(500)+'.mp3').name).toHaveLength(124);
});
it('downloads a local blob and revokes it after the browser has time to consume it',async()=>{
 vi.useFakeTimers();
 const anchor={href:'',download:'',style:{display:''},click:vi.fn(),remove:vi.fn()};
 vi.stubGlobal('document',{createElement:()=>anchor,body:{appendChild:vi.fn()}});
 const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test-download');const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 await shareAssetBytes('Victory.wav',new Uint8Array([1,2,3]));
 expect(anchor.href).toBe('blob:test-download');expect(anchor.download).toBe('Victory.wav');
 expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);expect((create.mock.calls[0][0] as Blob).type).toBe('audio/wav');
 expect(anchor.remove).toHaveBeenCalled();expect(revoke).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(60_000);expect(revoke).toHaveBeenCalledWith('blob:test-download');
});
it('cleans up after a failed click and refuses empty bytes before creating a download',async()=>{
 vi.useFakeTimers();const remove=vi.fn();
 vi.stubGlobal('document',{createElement:()=>({style:{},click:()=>{throw Error('download failed');},remove}),body:{appendChild:vi.fn()}});
 const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:failed');const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 await expect(shareAssetBytes('song.wav',new Uint8Array())).rejects.toThrow('empty');expect(create).not.toHaveBeenCalled();
 await expect(shareAssetBytes('song.wav',new Uint8Array([1]))).rejects.toThrow('download failed');expect(remove).toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(60_000);expect(revoke).toHaveBeenCalledWith('blob:failed');
});
