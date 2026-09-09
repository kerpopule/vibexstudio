import {it,expect,vi,beforeEach} from 'vitest';
import type {ProviderConnection} from '../src/lib/types';
import {restoreConnections} from '../src/lib/connection-transfer/restore';
import type {ConnectionTransfer} from '../src/lib/connection-transfer/bundle';
const storage=vi.hoisted(()=>new Map<string,string>());
vi.mock('@react-native-async-storage/async-storage',()=>({default:{getItem:async(key:string)=>storage.get(key)??null,setItem:async(key:string,value:string)=>{storage.set(key,value);}}}));
import {updateProviders,getProviders} from '../src/lib/storage/settings';
beforeEach(()=>storage.clear());
const transfer:ConnectionTransfer={format:'vibex/ai-connections',version:1,connections:[{kind:'openai',label:'Chat',model:'sample',secret:'test-chat'},{kind:'fal',label:'Media',model:'',secret:'test-media'}]};
it('preserves partial imports and retries the same file without overwriting already imported keys',async()=>{
 const vault=new Map<string,string>();let fail=true;let latest:ProviderConnection[]=[];
 const store={update:updateProviders,secret:async(id:string,key:string)=>{if(id.endsWith('-1')&&fail)throw new Error('PRIVATE error');vault.set(id,key);},changed:(providers:ProviderConnection[])=>{latest=providers;}};
 await expect(restoreConnections(transfer,'a'.repeat(64),store)).rejects.toThrow('connection 2');
 expect(latest).toHaveLength(1);expect(await getProviders()).toHaveLength(1);
 const first=latest[0].id;vault.set(first,'replacement-key');fail=false;
 expect(await restoreConnections(transfer,'a'.repeat(64),store)).toEqual({added:1,existing:1});
 expect(vault.get(first)).toBe('replacement-key');expect(latest).toHaveLength(2);
 expect(await restoreConnections(transfer,'a'.repeat(64),store)).toEqual({added:0,existing:2});
 expect(latest[1].capabilities).toEqual({chat:false,image:true,video:true});
});
it('does not publish a connection until its vault write succeeds; retries failed metadata persistence',async()=>{
 let current:ProviderConnection[]=[];let fail=true;const ids:string[]=[];
 const store={update:async(change:any)=>{const next=await change(current);if(fail)throw new Error('disk full');current=next;return current;},secret:async(id:string)=>{ids.push(id);},changed:()=>{}};
 await expect(restoreConnections({...transfer,connections:transfer.connections.slice(0,1)},'b'.repeat(64),store)).rejects.toThrow('Retry this same file');
 expect(current).toHaveLength(0);fail=false;
 await restoreConnections({...transfer,connections:transfer.connections.slice(0,1)},'b'.repeat(64),store);
 expect(ids[0]).toBe(ids[1]);expect(current).toHaveLength(1);
});
it('serializes provider-list changes and preserves concurrent additions',async()=>{
 const provider=(id:string)=>({id,kind:'custom',auth:'apiKey',label:id,defaultModel:'',capabilities:{chat:true,image:false,video:false},createdAt:1} as ProviderConnection);
 await Promise.all([updateProviders(async current=>{await new Promise(resolve=>setTimeout(resolve,5));return [...current,provider('one')];}),updateProviders(current=>[...current,provider('two')])]);
 expect((await getProviders()).map(p=>p.id)).toEqual(['one','two']);
});
it('preserves unreadable stored metadata rather than replacing it with an empty list',async()=>{
 storage.set('vibex.settings.providers','broken existing settings');
 await expect(updateProviders(()=>[])).rejects.toThrow('Existing settings were preserved');
 expect(storage.get('vibex.settings.providers')).toBe('broken existing settings');
});
