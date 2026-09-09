import {beforeEach,expect,it,vi} from 'vitest';
import {persistSongDraft,useSongDraft} from '@/lib/song-draft';
const saved={prompt:'A song about exploring',providerId:'my-fal',duration:30 as const,instrumental:true};
beforeEach(()=>{useSongDraft.getState().clear();useSongDraft.setState({storageError:false});});
it('restores the complete idea after restart without storing job state or credentials',async()=>{
 let raw:string|null=null;
 const storage={getItem:async()=>raw,setItem:async(_key:string,value:string)=>{raw=value;}};
 const first=await persistSongDraft(storage);
 useSongDraft.getState().update(saved);
 await first.flush();first.unsubscribe();
 expect(JSON.parse(raw!)).toEqual(saved);
 useSongDraft.getState().clear();
 const second=await persistSongDraft(storage);
 expect(useSongDraft.getState().draft).toEqual(saved);
 await second.flush();second.unsubscribe();
});
it('preserves newer input when storage finishes reading late',async()=>{
 let resolve!:(value:string)=>void;
 const storage={getItem:()=>new Promise<string>(r=>{resolve=r;}),setItem:vi.fn(async(_key:string,_value:string)=>{})};
 const loading=persistSongDraft(storage);
 useSongDraft.getState().update({prompt:'Newer idea',duration:120});
 resolve(JSON.stringify(saved));
 const handle=await loading;await handle.flush();handle.unsubscribe();
 expect(useSongDraft.getState().draft.prompt).toBe('Newer idea');
 expect(JSON.parse(storage.setItem.mock.calls[0][1])).toMatchObject({prompt:'Newer idea',duration:120});
});
it.each(['unreadable','malformed'])('does not overwrite %s stored data with empty defaults',async(mode)=>{
 const storage={getItem:async()=>{if(mode==='unreadable')throw new Error('denied');return '{broken';},setItem:vi.fn(async()=>{})};
 const handle=await persistSongDraft(storage);await handle.flush();
 expect(storage.setItem).not.toHaveBeenCalled();
 expect(useSongDraft.getState().storageError).toBe(true);
 handle.unsubscribe();
});
it('serializes writes and recovers a visible storage failure on a later edit',async()=>{
 let raw='';
 const storage={getItem:async()=>null,setItem:vi.fn(async(_key:string,value:string)=>{raw=value;})};
 storage.setItem.mockRejectedValueOnce(new Error('full'));
 const handle=await persistSongDraft(storage);
 useSongDraft.getState().update({prompt:'first'});await handle.flush();
 expect(useSongDraft.getState().storageError).toBe(true);
 useSongDraft.getState().update({prompt:'second'});
 useSongDraft.getState().update({prompt:'latest',instrumental:true});
 await handle.flush();handle.unsubscribe();
 expect(JSON.parse(raw)).toMatchObject({prompt:'latest',instrumental:true});
 expect(useSongDraft.getState().storageError).toBe(false);
});
