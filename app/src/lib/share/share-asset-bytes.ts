import {Directory,File,Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {exportFileName} from '@/lib/share/export-file';
/** Keep a cache copy alive for destination apps that read after the chooser closes. */
export async function shareAssetBytes(fileName:string,bytes:Uint8Array):Promise<void>{
 if(!bytes.length)throw new Error('The creation is empty. Refresh Library and try again.');
 const file=exportFileName(fileName);
 if(!await Sharing.isAvailableAsync())throw new Error('File sharing is unavailable on this device.');
 const folder=new Directory(Paths.cache,'creation-exports',`${Date.now()}-${Math.random().toString(36).slice(2)}`);
 folder.create({intermediates:true});
 const target=new File(folder,file.name);target.write(bytes);
 await Sharing.shareAsync(target.uri,{mimeType:file.mimeType,dialogTitle:'Save or share your creation'});
}
