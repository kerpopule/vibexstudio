import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), saved: '[]' }));
vi.mock('@react-native-async-storage/async-storage', () => ({default:{getItem:async()=>mocks.saved,setItem:async(_key:string,value:string)=>{mocks.saved=value;}}}));
vi.mock('@/lib/ai/media', () => ({generateImage:mocks.generate,canGenerateImages:()=>true}));
vi.mock('@/lib/storage/import-asset', () => ({importProjectAsset:vi.fn()}));
vi.mock('@/lib/storage/projects', () => ({writeBinaryFile:vi.fn(),writeFile:vi.fn(),deleteFile:vi.fn()}));
vi.mock('@/lib/storage/secrets', () => ({getProviderSecret:async()=> 'unused-test-key'}));
vi.mock('@/lib/store', () => ({useApp:{getState:()=>({mediaLab:{url:'https://spark.example'},providers:[{id:'paid-provider',label:'Paid provider'}]})}}));
import { handleMediaRequests } from '@/lib/medialab-tool';
import type { ProjectMeta } from '@/lib/types';
const project = {id:'test-project'} as ProjectMeta;
const request = {kind:'image' as const,file:'assets/hero.png',prompt:'A game hero'};
beforeEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();mocks.saved='[]';});
describe('explicit Media Lab routing',()=>{
  it('does not invoke a paid provider after the paired server rejects a request',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:401})));
    const result=await handleMediaRequests(project,[request]);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(result.writtenPaths).toEqual([]);
    expect(result.statusLines.join(' ')).toContain('No other provider was used');
  });
  it('does not invoke another provider after a network failure',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
    const result=await handleMediaRequests(project,[request]);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(result.writtenPaths).toEqual([]);
  });
  it('records the accepting server before claiming a queued project asset',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"id":"accepted-job"}',{status:200})));
    const result=await handleMediaRequests(project,[request]);
    expect(JSON.parse(mocks.saved)[0]).toMatchObject({serverUrl:'https://spark.example',jobId:'accepted-job',projectId:'test-project'});
    expect(result.writtenPaths).toEqual(['assets/hero.png']);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
