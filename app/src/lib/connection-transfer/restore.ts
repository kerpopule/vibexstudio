import {PROVIDERS} from '@/lib/ai/registry';
import type {ProviderConnection} from '@/lib/types';
import {validateTransfer,type ConnectionTransfer} from './bundle';
export interface RestoreConnectionsStore {
 update:(change:(current:ProviderConnection[])=>Promise<ProviderConnection[]>)=>Promise<ProviderConnection[]>;
 secret:(id:string,value:string)=>Promise<void>;
 changed:(providers:ProviderConnection[])=>void;
}
/** Each imported identity is stable for this encrypted file. A retry never resets an existing connection. */
export async function restoreConnections(input:ConnectionTransfer,fileSha256:string,store:RestoreConnectionsStore){
 if(!/^[a-f0-9]{64}$/.test(fileSha256))throw new Error('Invalid transfer identity.');
 const transfer=validateTransfer(input);let added=0,existing=0;
 for(const [index,entry] of transfer.connections.entries()){
  const id=`transfer-${fileSha256}-${index}`;
  let skipped=false;
  try{
   const providers=await store.update(async current=>{
    if(current.some(connection=>connection.id===id)){skipped=true;return current;}
    const connection:ProviderConnection={id,kind:entry.kind,auth:'apiKey',label:entry.label,baseUrl:entry.baseUrl,defaultModel:entry.model,mediaModels:entry.mediaModels,capabilities:{...PROVIDERS[entry.kind].capabilities},createdAt:Date.now()};
    // Publish metadata only after its vault write. If persistence fails, retry uses the same vault identity.
    await store.secret(id,entry.secret);
    return [...current,connection];
   });
   store.changed(providers);
   if(skipped)existing++;else added++;
  }catch{throw new Error(`Stopped while saving connection ${index+1}. Earlier connections are preserved. Retry this same file to continue without duplicating them.`);}
 }
 return {added,existing};
}
