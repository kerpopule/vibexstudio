import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AgentCredentialStore, AgentMetadataStore } from '@/lib/agent-connect/core';

type Invoke = (command:string,args:Record<string,unknown>)=>Promise<unknown>;
function bridge(): Invoke {
  const invoke=(globalThis as unknown as {__TAURI_INTERNALS__?:{invoke?:Invoke}}).__TAURI_INTERNALS__?.invoke;
  if(typeof invoke!=='function')throw new Error('Agent credentials require the installed desktop app.');
  return invoke;
}
const METADATA_KEY='vibex.agent-connect.metadata.v1';
function credentialKey(id:string):string {
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error('Invalid agent identifier.');
  return `vibex.agent-connect.credential.${id}`;
}
/** Non-secret metadata only; unavailable browser runtimes never read or write it. */
export const agentMetadataStore: AgentMetadataStore = {
  async load() { bridge(); return AsyncStorage.getItem(METADATA_KEY); },
  async save(value) { bridge(); await AsyncStorage.setItem(METADATA_KEY,value); },
};
/** No browser-storage fallback for an agent's bearer token. */
export const agentCredentialStore: AgentCredentialStore = {
  async get(id) {
    const value=await bridge()('secret_get',{key:credentialKey(id)});
    if(value!==null && typeof value!=='string')throw new Error('Invalid keychain response.');
    return value;
  },
  async set(id,value) { await bridge()('secret_set',{key:credentialKey(id),value}); },
  async remove(id) { await bridge()('secret_delete',{key:credentialKey(id)}); },
};
