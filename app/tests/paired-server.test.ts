import {beforeEach,it,expect,vi} from 'vitest';
import {encodeProjectSnapshot} from '../src/lib/sync/project-snapshot';
const mocks=vi.hoisted(()=>({pairing:vi.fn(),request:vi.fn(),read:vi.fn(),replace:vi.fn(),refresh:vi.fn(),reload:vi.fn(),bump:vi.fn(),getItem:vi.fn(),setItem:vi.fn()}));
vi.mock('@/lib/workbench',()=>({getWorkbenchPairing:mocks.pairing}));
vi.mock('@/lib/sync/server-transport',()=>({requestProjectSync:mocks.request}));
vi.mock('@react-native-async-storage/async-storage',()=>({default:mocks}));
vi.mock('expo-crypto',()=>({CryptoDigestAlgorithm:{SHA256:'sha'},digestStringAsync:async(_a:string,b:string)=>b}));
vi.mock('@/lib/storage/projects',()=>({listProjects:async()=>[],readSyncSnapshot:mocks.read,replaceSyncedProject:mocks.replace}));
vi.mock('@/lib/store',()=>({useApp:{getState:()=>({refreshProjects:mocks.refresh})}}));
vi.mock('@/lib/chat-engine',()=>({useChat:{getState:()=>({sessions:{},reload:mocks.reload,bumpFiles:mocks.bump})}}));
import {inspectPairedSync,syncPairedServer,pairedSyncConnection} from '../src/lib/sync/paired-server';
const raw=encodeProjectSnapshot({meta:{id:'p1',name:'From server',description:'',emoji:'✨',createdAt:1,updatedAt:1},chat:[],files:[{path:'index.html',content:'hello'}]});
beforeEach(()=>{vi.resetAllMocks();mocks.pairing.mockResolvedValue({url:'https://mine.test',token:'test'});mocks.read.mockResolvedValue(null);mocks.getItem.mockResolvedValue(null);});
it('does not treat a build-only server as a sync server',async()=>{
 mocks.request.mockResolvedValue({ok:true});expect(await inspectPairedSync()).toMatchObject({url:'https://mine.test',available:false});
 await expect(syncPairedServer('https://mine.test')).rejects.toThrow('not enabled');expect(mocks.replace).not.toHaveBeenCalled();
});
it('rejects a changed pairing before contacting it',async()=>{
 await expect(syncPairedServer('https://previous.test')).rejects.toThrow('changed');expect(mocks.request).not.toHaveBeenCalled();
});
it('receives a portable server project through compare-and-replace and refreshes it',async()=>{
 mocks.request.mockImplementation(async(_pair,body)=>!body?{projectSync:{version:1}}:body.operation==='list'?{projects:['p1']}:{heads:['r1'],revisions:[{revision:'r1',payload:raw}]});
 const result=await syncPairedServer('https://mine.test');expect(result.pulled).toBe(1);expect(result.failures).toEqual([]);expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(raw,null);expect(mocks.reload).toHaveBeenCalledWith('p1');expect(mocks.bump).toHaveBeenCalledWith('p1');
});
it('preserves a local project when received snapshot validation fails',async()=>{
 mocks.request.mockImplementation(async(_pair,body)=>!body?{projectSync:{version:1}}:body.operation==='list'?{projects:['p1']}:{heads:['r1'],revisions:[{revision:'r1',payload:'{}'}]});
 const result=await syncPairedServer('https://mine.test');expect(result.failures).toHaveLength(1);expect(mocks.replace).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
});

it('rejects a rotated token at the same URL before any request',async()=>{
 await expect(syncPairedServer('https://mine.test','old-identity')).rejects.toThrow('changed');expect(mocks.request).not.toHaveBeenCalled();
});
it('does not apply a received project after the user disconnects during download',async()=>{
 mocks.request.mockImplementation(async(_pair,body)=>{
  if(!body)return {projectSync:{version:1}};
  if(body.operation==='list')return {projects:['p1']};
  mocks.pairing.mockResolvedValue(null);return {heads:['r1'],revisions:[{revision:'r1',payload:raw}]};
 });
 const result=await syncPairedServer('https://mine.test');expect(result.failures).toHaveLength(1);expect(mocks.replace).not.toHaveBeenCalled();
});

it('returns the same connection identity used by the capability check',async()=>{
 mocks.request.mockResolvedValue({projectSync:{version:1}});
 const inspected=await inspectPairedSync(),connection=await pairedSyncConnection();
 expect(connection).toEqual({url:inspected.url,identity:inspected.identity});expect(typeof connection?.identity).toBe('string');
 mocks.pairing.mockResolvedValue(null);expect(await pairedSyncConnection()).toBeNull();
});
