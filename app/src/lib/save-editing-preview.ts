import * as Crypto from 'expo-crypto';
import {libraryOrigin} from '@/lib/library-core';
import {readEditingPreview,type EditingPreviewReceipt} from '@/lib/remote-editing';
import {readGalleryItem,saveEditedVideo} from '@/lib/storage/media-gallery';
import type {GalleryItem} from '@/lib/types';
const saves=new Map<string,Promise<GalleryItem>>();
export async function saveEditingPreview(origin:string,receipt:EditingPreviewReceipt,title:string):Promise<GalleryItem>{
 origin=libraryOrigin(origin);
 const id='edit-'+await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,JSON.stringify([origin,receipt.projectId,receipt.revision,receipt.sha256]));
 const active=saves.get(id);if(active)return active;
 const work=async()=>{
  const existing=await readGalleryItem(id);if(existing)return existing;
  const bytes=await readEditingPreview(origin,receipt);
  return saveEditedVideo(`${title.slice(0,160)} · revision ${receipt.revision} preview`,bytes,id);
 };
 const locks=typeof navigator!=='undefined'?navigator.locks:undefined;
 const promise=locks?locks.request('vibex-editing-save:'+id,work):work();saves.set(id,promise);
 try{return await promise;}finally{if(saves.get(id)===promise)saves.delete(id);}
}
