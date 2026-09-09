import * as Sharing from 'expo-sharing';
import type {GalleryItem} from '@/lib/types';
export type GalleryExport=Pick<GalleryItem,'id'|'uri'|'mimeType'>;
/** Share the saved device file directly, without uploading it to a VibeX service. */
export async function shareGalleryFile(item:GalleryExport):Promise<void>{
 if(!/^(file|content):/i.test(item.uri))throw new Error('This saved media does not have a local file to share.');
 if(!await Sharing.isAvailableAsync())throw new Error('File sharing is unavailable on this device.');
 await Sharing.shareAsync(item.uri,{mimeType:item.mimeType,dialogTitle:'Save or share your creation'});
}
