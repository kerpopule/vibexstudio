import {assertSafePath} from '@/lib/share/bundle';
import type {RemoteLibraryAsset} from '@/lib/library-core';
import {MAX_BINARY_IMPORT_BYTES} from '@/lib/storage/binary-import';
import type {ProjectMeta} from '@/lib/types';
export interface MediaImportAdapter {
 list():Promise<RemoteLibraryAsset[]>;read(asset:RemoteLibraryAsset):Promise<Uint8Array>;
 project(id:string):Promise<ProjectMeta|null>;
 commit(id:string,path:string,bytes:Uint8Array,createdAt:number):Promise<{alreadyImported:boolean}>;
 busy(id:string):boolean;refresh(id:string):Promise<void>;
}
export type ImageResultImportAdapter=Pick<MediaImportAdapter,'project'|'commit'|'busy'|'refresh'>;
export async function importAgentMedia(adapter:MediaImportAdapter,input:{projectId:string;assetId:string;path:string}){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(input.projectId))throw new Error('Invalid project identity.');
 const path=assertSafePath(input.path);if(path!==input.path||!path.startsWith('assets/')||path.length>180)throw new Error('Choose a relative path inside assets/.');
 if(adapter.busy(input.projectId))throw new Error('Wait for this project’s AI to finish.');
 const project=await adapter.project(input.projectId);if(!project)throw new Error('Project not found.');
 if(project.id!==input.projectId)throw new Error('The project identity changed. Refresh projects before trying again.');
 const asset=(await adapter.list()).find(asset=>asset.id===input.assetId);if(!asset)throw new Error('Asset not found in the connected library.');
 if(!Number.isSafeInteger(asset.bytes)||asset.bytes<=0||asset.bytes>MAX_BINARY_IMPORT_BYTES)throw new Error('Choose an asset no larger than 128 MiB for agent import.');
 if(path.split('.').pop()?.toLowerCase()!==asset.fileName.split('.').pop()?.toLowerCase())throw new Error('Use the same file extension as the library asset.');
 const bytes=await adapter.read(asset);if(bytes.length!==asset.bytes||bytes.length>MAX_BINARY_IMPORT_BYTES)throw new Error('The asset changed or exceeded the import limit.');
 if(adapter.busy(input.projectId))throw new Error('The project became busy. Try again when its AI finishes.');
 const result=await adapter.commit(input.projectId,path,bytes,project.createdAt);
 await adapter.refresh(input.projectId);
 return {projectId:input.projectId,assetId:asset.id,path,bytes:bytes.length,kind:asset.kind,...(result.alreadyImported?{alreadyImported:true}:{})};
}


/** Generated results use the same exclusive file commit as Library imports. */
export async function importAgentImageResult(
 adapter:ImageResultImportAdapter,
 input:{projectId:string;requestId:string;path:string},read:()=>Promise<Uint8Array>,
){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(input.projectId))throw new Error('Invalid project identity.');
 const path=assertSafePath(input.path);
 if(path!==input.path||path.length>180||!path.startsWith('assets/')||!path.toLowerCase().endsWith('.png'))throw new Error('Choose a PNG path inside assets/.');
 if(adapter.busy(input.projectId))throw new Error('Wait for this project’s AI to finish.');
 const project=await adapter.project(input.projectId);
 if(!project)throw new Error('Project not found.');
 if(project.id!==input.projectId)throw new Error('The project identity changed. Refresh projects before trying again.');
 const bytes=await read();
 if(bytes.length>16*1024*1024||bytes.length<8||![137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte)) {
   throw new Error('The result must be a PNG no larger than 16 MiB.');
 }
 if(adapter.busy(input.projectId))throw new Error('The project became busy. Try again when its AI finishes.');
 const result=await adapter.commit(input.projectId,path,bytes,project.createdAt);
 await adapter.refresh(input.projectId);
 return {projectId:input.projectId,requestId:input.requestId,path,bytes:bytes.length,kind:'image',...(result.alreadyImported?{alreadyImported:true}:{})};
}
