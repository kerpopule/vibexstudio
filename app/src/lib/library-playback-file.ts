import {Directory,File,Paths} from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import {playbackFormat} from './library-playback-format';

export async function libraryPlaybackFile(bytes:Uint8Array,mime:string):Promise<{uri:string;dispose:()=>void}>{
 const extension=playbackFormat(mime,bytes.length);
 const name=Array.from(Crypto.getRandomBytes(16),byte=>byte.toString(16).padStart(2,'0')).join('');
 const directory=new Directory(Paths.cache,'library-playback',name);
 directory.create({intermediates:true});
 try{
  const file=new File(directory,`media.${extension}`);file.write(bytes);
  return {uri:file.uri,dispose:()=>{try{directory.delete();}catch{}}};
 }catch(error){try{directory.delete();}catch{}throw error;}
}
