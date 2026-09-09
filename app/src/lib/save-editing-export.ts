import {editingExportSink} from '@/lib/editing-export-sink';
import {editingExportFetch} from '@/lib/editing-export-fetch';
import {streamEditingExport} from '@/lib/editing-export-stream';
import {editingExportAuthorization,type EditingExportReceipt} from '@/lib/remote-editing';
import {libraryOrigin} from '@/lib/library-core';
export async function saveEditingExport(origin:string,receipt:EditingExportReceipt){
 if(!/^cut-(?:[a-f0-9]{10}|[a-f0-9]{32})$/.test(receipt.projectId)||!Number.isSafeInteger(receipt.revision)||receipt.revision<0)throw new Error('The export identity is invalid.');
 const sink=await editingExportSink(`vibex-${receipt.projectId}-r${receipt.revision}.mp4`);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15*60_000);
 try{
  const token=await editingExportAuthorization(origin);
  const response=await editingExportFetch(libraryOrigin(origin)+`/api/studio/editing/projects/${receipt.projectId}/exports/${receipt.revision}/content`,{headers:{Authorization:`Bearer ${token}`},credentials:'omit',redirect:'error',signal:controller.signal});
  await streamEditingExport(response as Response,receipt,sink);
 }catch(error){await sink.abort().catch(()=>{});throw error;}finally{clearTimeout(timer);}
}
