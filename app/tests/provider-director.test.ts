import {beforeEach,expect,it,vi} from 'vitest';
import {directorCollections} from '@/lib/director-collections';
import {askProviderDirector} from '@/lib/provider-director';
import type {ProviderConnection} from '@/lib/types';
vi.mock('@/lib/director-collections',()=>({directorCollections:vi.fn(async()=>[])}));
const mocks=vi.hoisted(()=>({chat:vi.fn(),secret:vi.fn(),entries:vi.fn()}));
vi.mock('@/lib/ai/chat',()=>({streamChat:mocks.chat}));
vi.mock('@/lib/storage/secrets',()=>({getProviderSecret:mocks.secret}));
vi.mock('@/lib/library-entries',()=>({loadEntries:mocks.entries}));
const provider={id:'chosen',kind:'custom',label:'My AI',defaultModel:'chosen-model',capabilities:{chat:true}} as ProviderConnection;
beforeEach(()=>{vi.clearAllMocks();mocks.secret.mockResolvedValue('fixture-secret');mocks.chat.mockResolvedValue('Here is a plan.');});
it('uses only the explicitly chosen provider without a server or Library read',async()=>{
 expect(await askProviderDirector(provider,[{role:'user',content:'Plan a game'}])).toBe('Here is a plan.');
 expect(mocks.secret).toHaveBeenCalledWith('chosen');
 expect(mocks.chat.mock.calls[0][0]).toMatchObject({connection:provider,model:'chosen-model',secret:'fixture-secret'});
 expect(mocks.entries).not.toHaveBeenCalled();
});
it('shares bounded metadata only when requested, never file URLs or bytes',async()=>{
 mocks.entries.mockResolvedValue({items:[{id:'server-1',prompt:'A video',kind:'video',providerLabel:'Imported file',uri:'https://private.example/secret.mp4'}],deviceError:null,remoteError:null});
 await askProviderDirector(provider,[{role:'user',content:'Use my video'}],undefined,undefined,true,'https://lab.example');
 const system=mocks.chat.mock.calls[0][0].system;
 expect(system).toContain('A video');expect(system).toContain('Imported file');expect(system).toContain('not original generation time');expect(system).not.toContain('secret.mp4');
 expect(mocks.entries).toHaveBeenCalledWith('https://lab.example');
});
it('does not silently continue with missing requested Library context or missing credentials',async()=>{
 mocks.entries.mockResolvedValue({items:[],deviceError:null,remoteError:'offline'});
 await expect(askProviderDirector(provider,[],undefined,undefined,true)).rejects.toThrow('Library context');
 expect(mocks.chat).not.toHaveBeenCalled();
 mocks.secret.mockResolvedValue(null);
 await expect(askProviderDirector(provider,[])).rejects.toThrow('Reconnect');
 expect(mocks.chat).not.toHaveBeenCalled();
});

it('only loads saved cast and stories with the separate opt-in',async()=>{
 await askProviderDirector(provider,[{role:'user',content:'Plan'}]);
 expect(directorCollections).not.toHaveBeenCalled();
 await askProviderDirector(provider,[{role:'user',content:'Use cast'}],undefined,undefined,false,'https://lab.example',true);
 expect(directorCollections).toHaveBeenCalledWith('https://lab.example',undefined);
 await expect(askProviderDirector(provider,[],undefined,undefined,false,undefined,true)).rejects.toThrow('Connect Media Lab');
});

it('offers a reviewed asset proposal only with project and Library context',async()=>{
 mocks.entries.mockResolvedValue({items:[],deviceError:null,remoteError:null});
 await askProviderDirector(provider,[],{version:1,projectId:'game',title:'Game',assets:[]},undefined,true);
 expect(mocks.chat.mock.calls[0][0].system).toContain('fenced vibex-action');
 await askProviderDirector(provider,[]);
 expect(mocks.chat.mock.calls[1][0].system).not.toContain('fenced vibex-action');
});

it('retrieves an older named item from the latest user message without sharing the full catalog',async()=>{
 mocks.entries.mockResolvedValue({items:[...Array.from({length:30},(_,id)=>({id:`server-${id}`,kind:'video',prompt:'Recent clip'})),{id:'server-birthday',kind:'video',prompt:'Birthday party montage'}],deviceError:null,remoteError:null});
 await askProviderDirector(provider,[{role:'user',content:'Recent clip'},{role:'assistant',content:'A plan'},{role:'user',content:'Use my birthday party video'}],undefined,undefined,true);
 const system=mocks.chat.mock.calls[0][0].system;
 expect(system).toContain('server-birthday');expect(system).not.toContain('server-29');expect(system).toContain('lexical');
});
