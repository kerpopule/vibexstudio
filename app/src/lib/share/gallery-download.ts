import type {GalleryItem} from '@/lib/types';

/** Device gallery exports must use embedded media, never navigate to an arbitrary URL. */
export function galleryDownload(item:Pick<GalleryItem,'id'|'uri'|'mimeType'>){
 const extensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm','audio/wav':'wav','audio/mpeg':'mp3','audio/flac':'flac','audio/ogg':'ogg','audio/mp4':'m4a'};
 const extension=extensions[item.mimeType];
 if(!extension || !item.uri.startsWith(`data:${item.mimeType};base64,`))throw Error('This media format cannot be downloaded from the gallery.');
 const payload=item.uri.slice(item.uri.indexOf(',')+1);
 if(!payload || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length%4!==0)throw Error('The saved media is incomplete.');
 const id=item.id.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||'creation';
 return {href:item.uri,filename:`vibex-${id}.${extension}`};
}
