import {expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({files:new Map<string,string|Uint8Array>()}));
vi.mock('expo-file-system',()=>{
 class File {
  uri:string;constructor(_:unknown,name:string){this.uri=name;}
  get name(){return this.uri;}get exists(){return state.files.has(this.uri);}
  write(value:string|Uint8Array){state.files.set(this.uri,value);}
  delete(){state.files.delete(this.uri);}
  moveSync(target:File){state.files.set(target.uri,state.files.get(this.uri)!);state.files.delete(this.uri);this.uri=target.uri;}
  async text(){return state.files.get(this.uri) as string;}
 }
 class Directory{list(){return [...state.files.keys()].map(name=>new File(this,name));}}
 return {File,Directory};
});
vi.mock('@/lib/storage/projects',async()=>{const {Directory}=await import('expo-file-system');return {mediaLabRoot:()=>new Directory('fixture'),newId:()=>''};});
it('keeps the final native video when File.move changes the temporary object URI',async()=>{
 const {saveEditedVideo,readGalleryItem}=await import('@/lib/storage/media-gallery');
 const id='edit-'+'a'.repeat(64),bytes=new Uint8Array([1,2,3]);
 const item=await saveEditedVideo('Preview',bytes,id);
 expect(state.files.get(`${id}.mp4`)).toEqual(bytes);
 expect(state.files.has(`${id}.pending.mp4`)).toBe(false);
 expect(await readGalleryItem(id)).toEqual(item);
 expect(await saveEditedVideo('Retry',bytes,id)).toEqual(item);
});
