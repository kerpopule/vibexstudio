import type {ProviderConnection,ProviderKind} from '@/lib/types';

export interface TransferConnection {
 kind:ProviderKind; label:string; baseUrl?:string; model:string;
 mediaModels?:{image?:string;video?:string}; secret:string;
}
export interface ConnectionTransfer {format:'vibex/ai-connections';version:1;connections:TransferConnection[]}
const kinds=new Set(['openrouter','anthropic','openai','gemini','xai','zai','fal','custom']);
export const TRANSFER_LIMIT=256_000;
function text(value:unknown,max:number,allowEmpty=false):string{
 if(typeof value!=='string'||value.length>max||(!allowEmpty&&!value.trim())||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Invalid AI connection transfer.');
 return value;
}
/** Reconstruct only supported settings. Never import device IDs, grants or executable instructions. */
export function validateTransfer(input:unknown):ConnectionTransfer{
 const value=input as ConnectionTransfer;
 if(!value||value.format!=='vibex/ai-connections'||value.version!==1||!Array.isArray(value.connections)||!value.connections.length||value.connections.length>32)throw new Error('Unsupported AI connection transfer.');
 const connections=value.connections.map(entry=>{
  if(!entry||!kinds.has(entry.kind)||'subscription' in entry||'privateProvider' in entry||'refreshToken' in entry)throw new Error('This connection needs a fresh sign-in on the new device.');
  const result:TransferConnection={kind:entry.kind,label:text(entry.label,160),model:text(entry.model,300,true),secret:text(entry.secret,16_384,true)};
  if(entry.baseUrl!==undefined){
   const address=text(entry.baseUrl,2048);
   let url:URL;try{url=new URL(address);}catch{throw new Error('Invalid AI server address in transfer.');}
   if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Invalid AI server address in transfer.');
   result.baseUrl=address;
  }
  if(entry.mediaModels!==undefined){
   if(!entry.mediaModels||typeof entry.mediaModels!=='object')throw new Error('Invalid media model choices.');
   result.mediaModels={};
   for(const name of ['image','video'] as const)if(entry.mediaModels[name]!==undefined)result.mediaModels[name]=text(entry.mediaModels[name],300);
  }
  return result;
 });
 const result:ConnectionTransfer={format:'vibex/ai-connections',version:1,connections};
 if(JSON.stringify(result).length>TRANSFER_LIMIT)throw new Error('Too many AI settings to transfer at once.');
 return result;
}
export const canTransferConnection=(connection:ProviderConnection)=>connection.auth==='apiKey'&&!connection.subscription&&!connection.privateProvider;
export async function collectConnections(connections:ProviderConnection[],readSecret:(id:string)=>Promise<string|null>):Promise<ConnectionTransfer>{
 if(connections.some(connection=>!canTransferConnection(connection)))throw new Error('Subscription and private-device connections need a fresh sign-in. Select API-key connections only.');
 const entries:TransferConnection[]=[];
 for(const connection of connections){
  const secret=await readSecret(connection.id);
  if(secret===null)throw new Error('One selected connection could not be read from this device. Reconnect it before transferring.');
  entries.push({kind:connection.kind,label:connection.label,model:connection.defaultModel,baseUrl:connection.baseUrl,mediaModels:connection.mediaModels,secret});
 }
 return validateTransfer({format:'vibex/ai-connections',version:1,connections:entries});
}
