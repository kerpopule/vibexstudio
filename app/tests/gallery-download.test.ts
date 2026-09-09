import {expect,it} from 'vitest';
import {galleryDownload} from '@/lib/share/gallery-download';
import type {GalleryItem} from '@/lib/types';
const item=(uri:string,mimeType='image/png')=>({id:'../test:1',uri,mimeType} as GalleryItem);
it('exports exact embedded bytes with a bounded safe filename',()=>{
 const uri='data:image/png;base64,YWJj';
 expect(galleryDownload(item(uri))).toEqual({href:uri,filename:'vibex-test1.png'});
 expect(galleryDownload(item('data:video/mp4;base64,YWJj','video/mp4')).filename).toBe('vibex-test1.mp4');
});
it('rejects remote navigation, mismatched MIME, unsupported and malformed payloads',()=>{
 for(const uri of ['https://example.com/file.png','javascript:alert(1)','data:image/jpeg;base64,YWJj','data:image/png;base64,','data:image/png;base64,ab?='])expect(()=>galleryDownload(item(uri))).toThrow();
 expect(()=>galleryDownload(item('data:image/svg+xml;base64,YWJj','image/svg+xml'))).toThrow();
});
