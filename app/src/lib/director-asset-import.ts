import {digestStringAsync,CryptoDigestAlgorithm} from 'expo-crypto';
import {audioExtension} from '@/lib/audio-file';
import {loadEntries,type LibraryEntry} from '@/lib/library-entries';
import {readRemoteAsset} from '@/lib/remote-library';
import {readImportSource} from '@/lib/storage/import-source';
import {importBinaryAssetExclusive,readProject} from '@/lib/storage/projects';
import {MAX_BINARY_IMPORT_BYTES} from '@/lib/storage/binary-import';

export type DirectorAssetReview={entry:LibraryEntry;path:string;origin?:string;projectId:string;projectCreatedAt:number};
const identity=(item:LibraryEntry)=>JSON.stringify([item.id,item.kind,item.prompt,item.createdAt,item.mimeType,item.uri,item.remote]);
async function findEntry(id:string,origin?:string){
 if(!/^(server|device)-[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('This reply does not identify a Library item.');
 const result=await loadEntries(origin);
 if(id.startsWith('server-')?result.remoteError:result.deviceError)throw new Error('Reconnect or refresh Library before reviewing this item.');
 const entry=result.items.find(item=>item.id===id);
 if(!entry)throw new Error('This item is no longer in your Library. Ask Sparky to use an available item.');
 return entry;
}
export async function reviewDirectorAsset(projectId:string,assetId:string,origin?:string):Promise<DirectorAssetReview>{
 const project=await readProject(projectId);if(!project)throw new Error('This project is no longer available.');
 const entry=await findEntry(assetId,origin);
 const ext=entry.remote?entry.remote.fileName.split('.').pop()!.toLowerCase():entry.kind==='audio'?audioExtension(entry.mimeType):entry.kind==='video'?(entry.mimeType==='video/webm'?'webm':'mp4'):entry.mimeType==='image/jpeg'?'jpg':entry.mimeType==='image/webp'?'webp':'png';
 if(!/^(png|jpe?g|gif|webp|avif|mp4|webm|mov|mkv|mp3|wav|flac|m4a|ogg|glb)$/.test(ext))throw new Error('Open Library to import this file type.');
 if(entry.remote&&(!Number.isSafeInteger(entry.remote.bytes)||entry.remote.bytes<=0||entry.remote.bytes>MAX_BINARY_IMPORT_BYTES))throw new Error('Choose a file no larger than 128 MiB.');
 const hash=await digestStringAsync(CryptoDigestAlgorithm.SHA256,JSON.stringify([entry.remote?origin:'device',entry.id]));
 const folder={image:'Images',video:'Videos',audio:'Audio',model:'3D'}[entry.kind];
 const label=(entry.remote?entry.remote.fileName.replace(/\.[^.]+$/,''):entry.prompt)
  .normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64).replace(/-+$/,'')||entry.kind;
 return {entry,path:`assets/${folder}/${label}-${hash.slice(0,32)}.${ext}`,origin,projectId,projectCreatedAt:project.createdAt};
}
/** Called only from the reviewed Add button. The model chooses neither path nor project. */
export async function importDirectorAsset(review:DirectorAssetReview,available:()=>boolean){
 if(!available())throw new Error('Wait for the builder, and keep this project and Media Lab connection open.');
 const project=await readProject(review.projectId);
 if(!project||project.createdAt!==review.projectCreatedAt)throw new Error('The project changed. Review this item again.');
 const current=await findEntry(review.entry.id,review.origin);
 if(identity(current)!==identity(review.entry))throw new Error('The Library item changed. Review it again before copying.');
 if(!current.remote&&!/^(file:|content:|blob:|data:)/i.test(current.uri))throw new Error('This device item is not stored locally. Open Library to recover it first.');
 const bytes=current.remote?await readRemoteAsset(current.remote):await readImportSource(current.uri);
 if(!bytes.length||bytes.length>MAX_BINARY_IMPORT_BYTES)throw new Error('Choose a non-empty file no larger than 128 MiB.');
 if(current.remote&&bytes.length!==current.remote.bytes)throw new Error('The Library file changed. Review it again.');
 if(!available())throw new Error('The project became busy or the connection changed. Try again when it is ready.');
 const result=await importBinaryAssetExclusive(review.projectId,review.path,bytes,review.projectCreatedAt);
 return {path:review.path,...result};
}
