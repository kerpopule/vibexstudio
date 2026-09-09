import {selectLibrarySources,matchingLibraryTerms} from '@/lib/library-selection';
import {audioExtension} from '@/lib/audio-file';
import { planLibraryImports, type LibraryOffer, type LibraryRequest } from '@/lib/library-reuse-core';
import { listRemoteLibrary, readRemoteAsset } from '@/lib/remote-library';
import type { RemoteLibraryAsset } from '@/lib/library-core';
import { listGalleryMetadata, readGalleryItem } from '@/lib/storage/media-gallery';
import { importProjectAsset, writeImportedAsset } from '@/lib/storage/import-asset';
import { newId } from '@/lib/storage/projects';
import { useApp } from '@/lib/store';

interface Source { searchText?:string; offer:LibraryOffer; localId?:string; remote?:RemoteLibraryAsset }
export interface LibrarySnapshot { offers:LibraryOffer[]; sources:Map<string,Source>; unavailable:string[] }

export async function captureLibrarySnapshot(query=''): Promise<LibrarySnapshot> {
  const origin = useApp.getState().mediaLab?.url;
  const [local, remote] = await Promise.allSettled([listGalleryMetadata(), origin ? listRemoteLibrary(origin, 3000) : Promise.resolve([])]);
  const unavailable:string[] = [];
  if (local.status==='rejected') unavailable.push('The device library could not be read.');
  if (remote.status==='rejected') unavailable.push('The server library is unavailable or needs an access-code connection.');
  const sources:Source[] = [];
  if (local.status==='fulfilled') for (const item of local.value) {
    const extension = item.kind==='audio' ? audioExtension(item.mimeType) : item.mimeType==='image/jpeg' ? 'jpg' : item.mimeType==='image/webp' ? 'webp' : item.kind==='video' ? (item.mimeType==='video/webm'?'webm':'mp4') : 'png';
    sources.push({localId:item.id,offer:{ref:'',kind:item.kind,title:item.prompt,createdAt:item.createdAt,source:'device',extension}});
  }
  if (remote.status==='fulfilled') for (const item of remote.value) sources.push({remote:item,searchText:item.prompt,offer:{ref:'',kind:item.kind,title:item.title,createdAt:item.createdAt,source:'server',extension:item.fileName.split('.').pop()!}});
  const nonce = newId().replace(/[^A-Za-z0-9_-]/g,'');
  const chosen = selectLibrarySources(sources,query);
  chosen.forEach((item,index)=>{item.offer.ref=`asset_${nonce}_${index+1}`;item.offer.matchedTerms=matchingLibraryTerms(item,query);});
  return {offers:chosen.map((item)=>item.offer), sources:new Map(chosen.map((item)=>[item.offer.ref,item])), unavailable};
}

export async function importLibraryRequests(projectId:string, requests:LibraryRequest[], snapshot:LibrarySnapshot, occupied:string[], signal?:AbortSignal) {
  const plan=planLibraryImports(requests,snapshot.offers,occupied);
  const written:string[]=[];
  const errors:string[]=[];
  for (const {request,offer} of plan) {
    try {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      const source=snapshot.sources.get(offer.ref)!;
      if (source.remote) {
        const bytes=await readRemoteAsset(source.remote, signal);
        if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
        await writeImportedAsset(projectId,request.file,bytes);
      }
      else {
        const item=await readGalleryItem(source.localId!);
        if (!item) throw new Error('The creation was removed from the library.');
        await importProjectAsset(projectId,request.file,item.uri,signal);
      }
      written.push(request.file);
    } catch {
      if (signal?.aborted) { errors.push('Stopped before the app code was updated.'); break; }
      errors.push(`Could not import ${request.file}. Check the library connection and try again. The app code was not updated.`); break; }
  }
  return {written,errors};
}
