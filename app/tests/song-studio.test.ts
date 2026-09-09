import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({generate:vi.fn(),read:vi.fn(),save:vi.fn(),download:vi.fn(),forget:vi.fn(),get:vi.fn(),list:vi.fn(),secret:vi.fn(),providers:[] as any[]}));
vi.mock('@/lib/ai/media',()=>({generateFalSong:f.generate}));
vi.mock('@/lib/ai/fal-recovery',()=>({validateFalSongOptions:(value:unknown)=>value,forgetFalRequest:f.forget,getFalRequest:f.get,listFalRequests:f.list}));
vi.mock('@/lib/audio-file',()=>({downloadSong:f.download}));
vi.mock('@/lib/storage/media-gallery',()=>({readGalleryItem:f.read,saveGalleryAudio:f.save}));
vi.mock('@/lib/storage/secrets',()=>({getProviderSecret:f.secret}));
vi.mock('@/lib/storage/projects',()=>({newId:()=> 'song-test'}));
vi.mock('@/lib/store',()=>({useApp:{getState:()=>({providers:f.providers})}}));
import {useSongStudio} from '@/lib/song-studio';
beforeEach(()=>{
 vi.resetAllMocks();useSongStudio.setState({jobs:[],savedId:null});
 f.providers=[{id:'fal',label:'My fal',kind:'fal',auth:'apiKey'}];f.secret.mockResolvedValue('test-only');
 f.read.mockResolvedValue(null);f.generate.mockResolvedValue({url:'https://example.com/song.wav',mimeType:'audio/wav'});
 f.download.mockResolvedValue('UklGRg==');f.save.mockResolvedValue({id:'fal-song-test',kind:'audio'});f.forget.mockResolvedValue(undefined);f.get.mockResolvedValue(null);f.list.mockResolvedValue([]);
});
it('saves a generated song to a stable local identity before forgetting its request',async()=>{
 await useSongStudio.getState().start('fal',' Song ');
 expect(f.generate).toHaveBeenCalledWith(f.providers[0],'test-only','Song','song-test',undefined);
 expect(f.save).toHaveBeenCalledWith('Song','My fal','UklGRg==','audio/wav','song-test');
 expect(f.save.mock.invocationCallOrder[0]).toBeLessThan(f.forget.mock.invocationCallOrder[0]);
 expect(useSongStudio.getState().savedId).toBe('fal-song-test');expect(useSongStudio.getState().jobs).toEqual([]);
});
it('does not generate or download again when the result landed before tracking cleanup failed',async()=>{
 f.forget.mockRejectedValueOnce(Error('disk'));
 await useSongStudio.getState().start('fal','Song');
 f.read.mockResolvedValue({id:'fal-song-test',kind:'audio'});
 await useSongStudio.getState().resume('song-test');
 expect(f.generate).toHaveBeenCalledTimes(1);expect(f.save).toHaveBeenCalledTimes(1);expect(f.download).toHaveBeenCalledTimes(1);
 expect(useSongStudio.getState().savedId).toBe('fal-song-test');
});
it('retains a failed download for the same request and blocks a duplicate new song',async()=>{
 f.download.mockRejectedValueOnce(Error('offline'));f.get.mockResolvedValue({phase:'accepted'});
 await useSongStudio.getState().start('fal','Song');
 await expect(useSongStudio.getState().start('fal','Song')).rejects.toThrow('saved request');
 await useSongStudio.getState().resume('song-test');
 expect(f.generate.mock.calls.map(args=>args[3])).toEqual(['song-test','song-test']);
});
it('refuses retry of uncertain acceptance and does not silently switch providers',async()=>{
 f.generate.mockRejectedValueOnce(Error('unknown'));f.get.mockResolvedValue({phase:'submitting'});
 await useSongStudio.getState().start('fal','Song');await useSongStudio.getState().resume('song-test');
 expect(f.generate).toHaveBeenCalledTimes(1);
 useSongStudio.setState({jobs:[{id:'old',providerId:'missing',providerLabel:'Old',prompt:'Song',status:'error',review:false}]});
 await useSongStudio.getState().resume('old');expect(f.generate).toHaveBeenCalledTimes(1);
 expect(useSongStudio.getState().jobs[0].error).toContain('original fal');
});
it('reserves a running request before asynchronous vault access',async()=>{
 let finish!:(key:string)=>void;f.secret.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const first=useSongStudio.getState().start('fal','Song');
 await expect(useSongStudio.getState().start('fal','Other')).rejects.toThrow('Wait');
 await vi.waitFor(()=>expect(f.secret).toHaveBeenCalled());finish('test-only');await first;
 expect(f.generate).toHaveBeenCalledTimes(1);
});

it('resumes hydrated song settings instead of taking new screen defaults',async()=>{
 f.list.mockResolvedValue([{id:'earlier',providerId:'fal',providerLabel:'My fal',kind:'audio',prompt:'Song',phase:'accepted',songOptions:{duration:120,instrumental:true}}]);
 await useSongStudio.getState().hydrate();await useSongStudio.getState().resume('earlier');
 expect(f.generate).toHaveBeenCalledWith(f.providers[0],'test-only','Song','earlier',{duration:120,instrumental:true});
});

it('loads saved requests before allowing a new song after a cold start',async()=>{
 f.list.mockResolvedValue([{id:'old-accepted',providerId:'fal',providerLabel:'My fal',kind:'audio',prompt:'Song',phase:'accepted'}]);
 await expect(useSongStudio.getState().start('fal',' Song ')).rejects.toThrow('saved request');
 expect(f.generate).not.toHaveBeenCalled();expect(f.secret).not.toHaveBeenCalled();
 expect(useSongStudio.getState().jobs[0].id).toBe('old-accepted');
});
it('refuses new paid work if saved tracking cannot be read, then permits a successful retry',async()=>{
 f.list.mockRejectedValueOnce(Error('storage unavailable'));
 await expect(useSongStudio.getState().start('fal','Song')).rejects.toThrow('could not be checked');
 expect(f.generate).not.toHaveBeenCalled();expect(f.secret).not.toHaveBeenCalled();
 await useSongStudio.getState().start('fal','Song');
 expect(f.generate).toHaveBeenCalledTimes(1);
});
it('reserves submission while the initial request list is still loading',async()=>{
 let finish!:(rows:unknown[])=>void;
 f.list.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const first=useSongStudio.getState().start('fal','Song');
 await expect(useSongStudio.getState().start('fal','Other')).rejects.toThrow('Wait');
 expect(f.generate).not.toHaveBeenCalled();
 finish([]);await first;
 expect(f.generate).toHaveBeenCalledTimes(1);
});
