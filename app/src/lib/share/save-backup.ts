import {Directory,File,Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
export async function saveBackupFile(raw:string,kind:'project'|'ai'='project'):Promise<void>{
 if(!await Sharing.isAvailableAsync())throw new Error('File sharing is unavailable on this device.');
 const folder=new Directory(Paths.cache,'project-backups');if(!folder.exists)folder.create({intermediates:true});
 const file=new File(folder,`vibex-${kind==='ai'?'ai-connections':'backup'}-${Date.now()}.json`);file.write(raw);
 // Keep the cache file available: Android receivers may read after the chooser closes.
 await Sharing.shareAsync(file.uri,{mimeType:'application/json',UTI:'public.json',dialogTitle:kind==='ai'?'Save encrypted AI connections':'Save your project backup'});
}
