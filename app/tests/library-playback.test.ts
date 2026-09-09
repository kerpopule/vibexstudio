import {afterEach,expect,it,vi} from 'vitest';
import {libraryPlaybackFile} from '../src/lib/library-playback-file.web';
import {MAX_PLAYBACK_BYTES,playbackFormat} from '../src/lib/library-playback-format';
afterEach(()=>vi.restoreAllMocks());
it('preserves playback bytes and MIME and releases the temporary URL',async()=>{
 let captured:Blob|undefined;
 vi.spyOn(URL,'createObjectURL').mockImplementation(blob=>{captured=blob as Blob;return 'blob:private-playback';});
 const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const data=new Uint8Array([82,73,70,70]);
 const file=await libraryPlaybackFile(data,'audio/wav');
 expect(captured?.type).toBe('audio/wav');
 expect(new Uint8Array(await captured!.arrayBuffer())).toEqual(data);
 expect(file.uri).toBe('blob:private-playback');
 file.dispose();expect(revoke).toHaveBeenCalledWith(file.uri);
});
it('rejects invalid formats and sizes before creating playback resources',async()=>{
 const create=vi.spyOn(URL,'createObjectURL');
 await expect(libraryPlaybackFile(new Uint8Array([1]),'text/html')).rejects.toThrow('format');
 await expect(libraryPlaybackFile(new Uint8Array(),'audio/wav')).rejects.toThrow('128 MB');
 expect(()=>playbackFormat('video/mp4',MAX_PLAYBACK_BYTES+1)).toThrow('128 MB');
 expect(create).not.toHaveBeenCalled();
});
