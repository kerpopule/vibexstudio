import {galleryDownload} from '@/lib/share/gallery-download';
import type {GalleryItem} from '@/lib/types';
export type GalleryExport=Pick<GalleryItem,'id'|'uri'|'mimeType'>;
/** A plain-browser or desktop-web download of the already-saved media bytes. */
export async function shareGalleryFile(item:GalleryExport):Promise<void>{
 const download=galleryDownload(item),anchor=document.createElement('a');
 anchor.href=download.href;anchor.download=download.filename;anchor.style.display='none';
 try{document.body.appendChild(anchor);anchor.click();}finally{anchor.remove();}
}
