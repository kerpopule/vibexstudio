import {saveProjectDirectoryArchive} from './save-project-archive.web';
import {restoreProjectDirectoryArchive} from '../storage/projects.web';
import * as DocumentPicker from 'expo-document-picker';
export function projectArchivesAvailable(){
 return typeof navigator!=='undefined'&&!!navigator.locks?.request&&
  (!!navigator.storage?.getDirectory||(typeof window!=='undefined'&&typeof (window as any).showSaveFilePicker==='function'));
}
export const saveProjectArchive=saveProjectDirectoryArchive;
export const restoreProjectArchive=restoreProjectDirectoryArchive;
export async function pickProjectArchive(){
 const result=await DocumentPicker.getDocumentAsync({type:['application/zip','application/octet-stream'],copyToCacheDirectory:false});
 if(result.canceled)return null;
 const file=result.assets[0]?.file;
 if(!file)throw new Error('This browser did not provide a readable archive file.');
 if(!/\.(vibexdir|zip)$/i.test(file.name)||file.size>0xffffffff)throw new Error('Choose a VibeX project archive smaller than 4 GiB.');
 return {name:file.name,input:file};
}
