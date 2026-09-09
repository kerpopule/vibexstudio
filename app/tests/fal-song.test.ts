import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('expo-crypto',()=>({}));
const saved=vi.hoisted(()=>new Map<string,string>());
vi.mock('@react-native-async-storage/async-storage',()=>({default:{getItem:async(k:string)=>saved.get(k)??null,setItem:async(k:string,v:string)=>{saved.set(k,v);}}}));
import {generateFalSong,FAL_SONG_MODEL} from '../src/lib/ai/media';
import type {ProviderConnection} from '../src/lib/types';
const provider={id:'my-fal',kind:'fal',auth:'apiKey',label:'My fal'} as ProviderConnection;
const accepted={status_url:'https://queue.fal.run/fal-ai/ace-step/requests/test/status',response_url:'https://queue.fal.run/fal-ai/ace-step/requests/test'};
beforeEach(()=>{saved.clear();vi.useFakeTimers();});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
it('submits a durable audio request, then resumes the accepted job without a second POST',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,options)=>new Response(JSON.stringify(options?.method==='POST'?accepted:String(_url).endsWith('/status')?{status:'COMPLETED'}:{audio:{url:'https://example.com/song.wav',content_type:'audio/wav'}})));
 const first=generateFalSong(provider,'test-key','  A gentle song  ','song-1');await vi.advanceTimersByTimeAsync(3100);
 expect(await first).toEqual({url:'https://example.com/song.wav',mimeType:'audio/wav'});
 const again=generateFalSong(provider,'test-key','A gentle song','song-1');await vi.advanceTimersByTimeAsync(3100);await again;
 expect(fetcher.mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(1);
 expect(fetcher.mock.calls[0][0]).toBe('https://queue.fal.run/'+FAL_SONG_MODEL);
 expect(JSON.stringify([...saved.values()])).not.toContain('test-key');
 expect(JSON.parse([...saved.values()][0]).kind).toBe('audio');
});
it('rejects unsupported connections and missing prompt or identity before network access',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch');
 for(const [connection,prompt,id] of [[{...provider,kind:'openai'},'song','id'],[provider,'','id'],[provider,'song','']] as [ProviderConnection,string,string][]){
  await expect(generateFalSong(connection,'test-key',prompt,id)).rejects.toThrow();
 }
 expect(fetcher).not.toHaveBeenCalled();
});
it('leaves a lost submission uncertain instead of resubmitting a paid song',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('connection lost'));
 await expect(generateFalSong(provider,'test-key','Song','song-unknown')).rejects.toThrow('may still run');
 await expect(generateFalSong(provider,'test-key','Song','song-unknown')).rejects.toThrow('unknown');
 expect(fetcher).toHaveBeenCalledTimes(1);
});

it('refuses unexpected output URLs and formats while retaining accepted tracking',async()=>{
 const outputs=[{url:'http://example.com/song.wav'},{url:'https://user:password@example.com/song.wav'},{url:'https://example.com/song.wav',content_type:'text/html'},{}];
 for(const [index,audio] of outputs.entries()){
  vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,options)=>new Response(JSON.stringify(options?.method==='POST'?accepted:String(_url).endsWith('/status')?{status:'COMPLETED'}:{audio})));
  const request=generateFalSong(provider,'test-key','Song','bad-result-'+index);
  const rejection=expect(request).rejects.toThrow();await vi.advanceTimersByTimeAsync(3100);await rejection;
  expect(JSON.parse(saved.get('vibex.fal-request.v1.bad-result-'+index)!).phase).toBe('accepted');
 }
});
