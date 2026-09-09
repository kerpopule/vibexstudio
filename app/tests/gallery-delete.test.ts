import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
it('waits for web transaction commit and rejects a late abort',async()=>{
 const transaction={oncomplete:null as null|(()=>void),onabort:null as null|(()=>void),onerror:null,error:null,objectStore:()=>({delete:vi.fn()})};
 const open={onsuccess:null as null|(()=>void),result:{transaction:()=>transaction}};
 vi.stubGlobal('indexedDB',{open:()=>{queueMicrotask(()=>open.onsuccess?.());return open;}});
 const {deleteGalleryItem}=await import('@/lib/storage/media-gallery.web');
 let settled=false;const pending=deleteGalleryItem('asset').then(()=>{settled=true;});
 await vi.waitFor(()=>expect(transaction.oncomplete).toBeTypeOf('function'));
 expect(settled).toBe(false);transaction.onabort?.();await expect(pending).rejects.toThrow('aborted');
 const success=deleteGalleryItem('asset');await Promise.resolve();transaction.oncomplete?.();await success;
});

it('does not report a saved image until its transaction commits',async()=>{
 const put=vi.fn();
 const transaction={oncomplete:null as null|(()=>void),onabort:null as null|(()=>void),onerror:null,error:null,objectStore:()=>({put})};
 const open={onsuccess:null as null|(()=>void),result:{transaction:()=>transaction}};
 vi.stubGlobal('indexedDB',{open:()=>{queueMicrotask(()=>open.onsuccess?.());return open;}});
 const {saveGalleryImage}=await import('@/lib/storage/media-gallery.web');
 let settled=false;const saving=saveGalleryImage('Sprite','Fixture','YWJj','image/png').then(item=>{settled=true;return item;});
 await vi.waitFor(()=>expect(put).toHaveBeenCalledTimes(1));
 expect(settled).toBe(false);transaction.onabort?.();await expect(saving).rejects.toThrow('aborted');
 const success=saveGalleryImage('Sprite','Fixture','YWJj','image/png');
 await vi.waitFor(()=>expect(put).toHaveBeenCalledTimes(2));transaction.oncomplete?.();
 expect(await success).toMatchObject({prompt:'Sprite',uri:'data:image/png;base64,YWJj'});
});
