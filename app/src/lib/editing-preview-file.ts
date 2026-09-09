import {Directory,File,Paths} from 'expo-file-system';
import * as Crypto from 'expo-crypto';
/** A temporary playback copy. Explicit export is a separate user action. */
export async function editingPreviewFile(bytes:Uint8Array):Promise<{uri:string;dispose:()=>void}>{
 const name=Array.from(Crypto.getRandomBytes(16),byte=>byte.toString(16).padStart(2,'0')).join('');
 const directory=new Directory(Paths.cache,'editing-previews',name);
 directory.create({intermediates:true});
 try{const file=new File(directory,'preview.mp4');file.write(bytes);return {uri:file.uri,dispose:()=>{try{directory.delete();}catch{}}};}
 catch(error){try{directory.delete();}catch{}throw error;}
}
