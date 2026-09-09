import {File} from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import {nativeArchiveInput} from './archive-input.native';
export {saveNativeProjectArchive as saveProjectArchive} from './save-project-archive.native';
export {restoreNativeProjectArchive as restoreProjectArchive} from './restore-project-archive.native';
export function projectArchivesAvailable(){return true;}
export async function pickProjectArchive(){
 const result=await DocumentPicker.getDocumentAsync({type:['application/zip','application/octet-stream'],copyToCacheDirectory:false});
 if(result.canceled)return null;
 const asset=result.assets[0];
 if(!asset||!asset.uri||! /\.(vibexdir|zip)$/i.test(asset.name))throw new Error('Choose a VibeX project archive (.vibexdir or .zip).');
 return {name:asset.name,input:nativeArchiveInput(new File(asset.uri))};
}
