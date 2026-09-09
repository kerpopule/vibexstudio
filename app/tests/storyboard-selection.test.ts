import {expect,it} from 'vitest';
import {storyboardSelectionStorage} from '../src/lib/storyboard-selection';
function storage(){const data=new Map<string,string>();return {getItem:async(key:string)=>data.get(key)??null,setItem:async(key:string,value:string)=>{data.set(key,value);},removeItem:async(key:string)=>{data.delete(key);}};}
const origin='https://media.example',digest='a'.repeat(64);
it('restores unfinished scenes across storage instances and separates server, board and source revision',async()=>{
 const disk=storage(),first=storyboardSelectionStorage(disk);
 const choice={title:'My copy',musicAssetId:'song',scenes:[{assetId:'video',seconds:'1.5'},{assetId:'',seconds:''}]};
 await first.save(origin,'board',digest,choice);
 const restarted=storyboardSelectionStorage(disk);
 expect(await restarted.read(origin,'board',digest)).toEqual(choice);
 expect(await restarted.read('https://other.example','board',digest)).toBeNull();
 expect(await restarted.read(origin,'another',digest)).toBeNull();
 expect(await restarted.read(origin,'board','b'.repeat(64))).toBeNull();
});
it('keeps the latest queued edits and does not clear choices changed after submission',async()=>{
 const review=storyboardSelectionStorage(storage());
 const old={title:'First',scenes:[{assetId:'video',seconds:'1'}]},latest={title:'Latest',scenes:[{assetId:'video',seconds:'2'}]};
 await Promise.all([review.save(origin,'board',digest,old),review.save(origin,'board',digest,latest)]);
 expect(await review.clear(origin,'board',digest,old)).toBe(false);
 expect(await review.read(origin,'board',digest)).toEqual(latest);
 expect(await review.clear(origin,'board',digest,latest)).toBe(true);
});
