import {afterEach,expect,it,vi} from 'vitest';
import {galleryDownload} from '@/lib/share/gallery-download';
const modulePath=process.env.VIBEX_TEST_INDEXEDDB_MODULE;
afterEach(()=>{vi.resetModules();vi.unstubAllGlobals();});
it.skipIf(!modulePath)('persists playable audio across reload with one stable gallery identity',async()=>{
 const database=await import(/* @vite-ignore */ modulePath!);
 vi.stubGlobal('indexedDB',new database.IDBFactory());vi.resetModules();
 let gallery=await import('@/lib/storage/media-gallery.web');
 await gallery.saveGalleryAudio('Victory song','My fal','UklGRg==','audio/wav','saved-song');
 vi.resetModules();gallery=await import('@/lib/storage/media-gallery.web');
 const item=await gallery.readGalleryItem('fal-saved-song');
 expect(item).toMatchObject({kind:'audio',uri:'data:audio/wav;base64,UklGRg==',prompt:'Victory song'});
 expect(galleryDownload(item!).filename).toBe('vibex-fal-saved-song.wav');
 await gallery.saveGalleryAudio('Victory song','My fal','UklGRg==','audio/wav','saved-song');
 expect(await gallery.listGalleryMetadata()).toHaveLength(1);
 await expect(gallery.saveGalleryAudio('bad','My fal','UklGRg==','text/html','bad')).rejects.toThrow('Unsupported');
 expect(await gallery.listGalleryMetadata()).toHaveLength(1);
});
