import type {ProviderConnection} from '@/lib/types';
export function canReplaceProviderKey(provider:ProviderConnection):boolean {
 return provider.auth==='apiKey'&&!provider.subscription&&!provider.privateProvider;
}
export async function replaceProviderKey(id:string,secret:string,deps:{providers:()=>ProviderConnection[];write:(id:string,key:string)=>Promise<void>;remove:(id:string)=>Promise<void>}):Promise<void>{
 const value=secret.trim();
 if(!value||value.length>16384)throw new Error('Paste a valid API key.');
 const provider=deps.providers().find(row=>row.id===id);
 if(!provider||!canReplaceProviderKey(provider))throw new Error('This connection cannot be updated with an API key.');
 // Do not delete the old credential first. A failed vault write must not
 // intentionally disconnect an otherwise usable provider.
 await deps.write(id,value);
 if(!deps.providers().some(row=>row===provider)){
  // A removal can finish while a credential-vault prompt is open. Never
  // recreate the removed connection or leave an orphan credential behind.
  if(!deps.providers().some(row=>row.id===id))await deps.remove(id);
  throw new Error('The connection changed while saving. Review it in Setup.');
 }
}
