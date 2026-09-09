import {afterEach,expect,it,vi} from 'vitest';
const metadata=vi.hoisted(()=>({getItem:vi.fn(),setItem:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage',()=>({default:metadata}));
import {agentCredentialStore,agentMetadataStore} from '../src/lib/agent-connect/persistence';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
it('routes tokens only through desktop vault commands',async()=>{
 const invoke=vi.fn().mockResolvedValue('fixture');vi.stubGlobal('__TAURI_INTERNALS__',{invoke});
 await agentCredentialStore.set('agent-1','fixture');
 expect(invoke).toHaveBeenLastCalledWith('secret_set',{key:'vibex.agent-connect.credential.agent-1',value:'fixture'});
 expect(await agentCredentialStore.get('agent-1')).toBe('fixture');
 await agentCredentialStore.remove('agent-1');
 expect(invoke).toHaveBeenLastCalledWith('secret_delete',{key:'vibex.agent-connect.credential.agent-1'});
 expect(metadata.setItem).not.toHaveBeenCalled();
 await expect(agentCredentialStore.get('../other')).rejects.toThrow('Invalid agent');
});
it('refuses browser persistence instead of falling back to local storage',async()=>{
 vi.stubGlobal('__TAURI_INTERNALS__',undefined);
 const setItem=vi.fn();vi.stubGlobal('localStorage',{setItem});
 await expect(agentCredentialStore.set('a','secret')).rejects.toThrow('installed desktop');
 await expect(agentMetadataStore.save('[]')).rejects.toThrow('installed desktop');
 expect(setItem).not.toHaveBeenCalled();expect(metadata.setItem).not.toHaveBeenCalled();
});
