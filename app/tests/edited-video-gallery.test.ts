import {afterEach,expect,it,vi} from 'vitest';
const modulePath=process.env.VIBEX_TEST_INDEXEDDB_MODULE;
afterEach(()=>{vi.resetModules();vi.unstubAllGlobals();});
it.skipIf(!modulePath)('preserves preview bytes across reload and deduplicates retries',async()=>{
 const database=await import(/* @vite-ignore */ modulePath!);
 vi.stubGlobal('indexedDB',new database.IDBFactory());vi.resetModules();
 let gallery=await import('@/lib/storage/media-gallery.web');
 const id='edit-'+'a'.repeat(64),bytes=new Uint8Array(Array.from({length:20000},(_,i)=>i%256));
 const original=await gallery.saveEditedVideo('My edit · revision 2 preview',bytes,id);
 vi.resetModules();gallery=await import('@/lib/storage/media-gallery.web');
 const item=await gallery.readGalleryItem(id);
 expect(item).toEqual(original);expect(item).toMatchObject({kind:'video',mimeType:'video/mp4',providerLabel:'Edited preview'});
 expect(Buffer.from(item!.uri.split(',')[1],'base64')).toEqual(Buffer.from(bytes));
 expect(await gallery.saveEditedVideo('Retry',bytes,id)).toEqual(original);
 expect(await gallery.listGalleryMetadata()).toHaveLength(1);
 await expect(gallery.saveEditedVideo('Invalid',bytes,'../bad')).rejects.toThrow('Invalid');
 await expect(gallery.saveEditedVideo('Empty',new Uint8Array(),id)).rejects.toThrow('Invalid');
});
