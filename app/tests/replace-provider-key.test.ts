import {expect,it,vi} from 'vitest';
import type {ProviderConnection} from '../src/lib/types';
import {canReplaceProviderKey,replaceProviderKey} from '../src/lib/ai/replace-provider-key';
const provider={id:'fal-original',kind:'fal',auth:'apiKey',label:'My fal',defaultModel:'model',mediaModels:{image:'fal-ai/original'},createdAt:1} as ProviderConnection;
it('replaces only the credential while preserving connection metadata and identity',async()=>{
 const rows=[provider],before=JSON.stringify(rows),write=vi.fn(async()=>{}),remove=vi.fn(async()=>{});
 await replaceProviderKey(provider.id,'  replacement-test-key  ',{providers:()=>rows,write,remove});
 expect(write).toHaveBeenCalledWith(provider.id,'replacement-test-key');expect(remove).not.toHaveBeenCalled();expect(JSON.stringify(rows)).toBe(before);
});
it('does not delete the existing credential when its replacement write fails',async()=>{
 const remove=vi.fn(async()=>{});
 await expect(replaceProviderKey(provider.id,'replacement-test-key',{providers:()=>[provider],write:async()=>{throw new Error('vault locked');},remove})).rejects.toThrow('vault locked');
 expect(remove).not.toHaveBeenCalled();
});
it('refuses missing, OAuth, subscription and private connections before writing',async()=>{
 const write=vi.fn(async()=>{}),remove=vi.fn(async()=>{});
 for(const rows of [[],[{...provider,auth:'oauth'}],[{...provider,subscription:'chatgpt-oauth'}],[{...provider,privateProvider:{}}]] as ProviderConnection[][]){
  await expect(replaceProviderKey(provider.id,'test-key',{providers:()=>rows,write,remove})).rejects.toThrow('cannot');
 }
 expect(write).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();expect(canReplaceProviderKey(provider)).toBe(true);
});
it('cleans up a credential if the connection was removed while the vault prompt was open',async()=>{
 let rows=[provider];const remove=vi.fn(async()=>{});
 await expect(replaceProviderKey(provider.id,'test-key',{providers:()=>rows,write:async()=>{rows=[];},remove})).rejects.toThrow('changed');
 expect(remove).toHaveBeenCalledWith(provider.id);expect(rows).toEqual([]);
});
it('refuses empty or oversized replacement values',async()=>{
 const write=vi.fn(async()=>{});
 for(const key of ['  ','x'.repeat(16385)])await expect(replaceProviderKey(provider.id,key,{providers:()=>[provider],write,remove:async()=>{}})).rejects.toThrow('valid');
 expect(write).not.toHaveBeenCalled();
});
