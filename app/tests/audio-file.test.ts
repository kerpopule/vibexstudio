import {afterEach,expect,it,vi} from 'vitest';
import {audioExtension,downloadSong} from '@/lib/audio-file';
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
it('downloads audio bytes without provider credentials, redirects or ambient cookies',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new Uint8Array([1,2,3])));
 expect(await downloadSong('https://example.com/song.wav')).toBe('AQID');
 expect(fetcher).toHaveBeenCalledWith('https://example.com/song.wav',expect.objectContaining({credentials:'omit',redirect:'error'}));
 expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined();expect(audioExtension('audio/mpeg')).toBe('mp3');
});
it('rejects empty or oversized audio and unsupported URLs',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(''));
 await expect(downloadSong('https://example.com/empty')).rejects.toThrow('empty');
 fetcher.mockResolvedValue(new Response('x',{headers:{'content-length':'25000001'}}));
 await expect(downloadSong('https://example.com/large')).rejects.toThrow('25 MB');
 const count=fetcher.mock.calls.length;await expect(downloadSong('file:///private.wav')).rejects.toThrow('URL');expect(fetcher).toHaveBeenCalledTimes(count);
});
it('bounds a stalled response body',async()=>{
 vi.useFakeTimers();const cancel=vi.fn();
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new ReadableStream({cancel})));
 const waiting=downloadSong('https://example.com/stalled');const rejection=expect(waiting).rejects.toThrow('timed out');
 await vi.advanceTimersByTimeAsync(60_001);await rejection;expect(cancel).toHaveBeenCalled();
});
