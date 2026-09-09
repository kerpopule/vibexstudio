import {expect,it,vi} from 'vitest';
vi.mock('@react-native-async-storage/async-storage',()=>({default:{}}));
import {editingSelectionStorage} from '@/lib/editing-selection';
function fixture(){const files=new Map<string,string>();const storage={getItem:async(k:string)=>files.get(k)??null,setItem:async(k:string,v:string)=>{files.set(k,v);},removeItem:async(k:string)=>{files.delete(k);}};return {files,storage,selection:editingSelectionStorage(storage)};}
const draft={title:'My music video',assetIds:['song','scene']};
it('restores choices across a new storage binding and isolates server and workflow',async()=>{
 const {storage,selection}=fixture();await selection.save('https://one.example',true,draft);
 const restarted=editingSelectionStorage(storage);
 expect(await restarted.read('https://one.example',true)).toEqual(draft);
 expect(await restarted.read('https://one.example',false)).toBeNull();
 expect(await restarted.read('https://two.example',true)).toBeNull();
});
it('serializes edits and keeps later choices when an older server request finishes',async()=>{
 const {selection}=fixture();const next={...draft,title:'Next music video'};
 await Promise.all([selection.save('https://one.example',true,draft),selection.save('https://one.example',true,next)]);
 expect(await selection.clear('https://one.example',true,draft)).toBe(false);
 expect(await selection.read('https://one.example',true)).toEqual(next);
 expect(await selection.clear('https://one.example',true,next)).toBe(true);
 expect(await selection.read('https://one.example',true)).toBeNull();
});
it('reports malformed data and failed storage without poisoning later retries',async()=>{
 const {files,storage}=fixture();let fail=true;
 const selection=editingSelectionStorage({...storage,setItem:async(k,v)=>{if(fail)throw Error('Storage full');await storage.setItem(k,v);}});
 await expect(selection.save('https://one.example',true,draft)).rejects.toThrow('Storage full');
 fail=false;await selection.save('https://one.example',true,draft);
 const key=[...files.keys()][0];files.set(key,'{"title":7}');
 await expect(selection.read('https://one.example',true)).rejects.toThrow('Saved editing choices');
 expect(files.get(key)).toBe('{"title":7}');
});
it('snapshots input before asynchronous writes and rejects duplicate source identities',async()=>{
 const {selection}=fixture();const value={...draft,assetIds:[...draft.assetIds]};
 const pending=selection.save('https://one.example',true,value);value.assetIds.push('other');await pending;
 expect(await selection.read('https://one.example',true)).toEqual(draft);
 expect(()=>selection.save('https://one.example',true,{...draft,assetIds:['same','same']})).toThrow();
});
