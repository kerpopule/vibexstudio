import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({local:vi.fn(),remote:vi.fn(),counter:0}));
vi.mock('@/lib/storage/media-gallery',()=>({listGalleryMetadata:mocks.local,readGalleryItem:vi.fn()}));
vi.mock('@/lib/remote-library',()=>({listRemoteLibrary:mocks.remote,readRemoteAsset:vi.fn()}));
vi.mock('@/lib/storage/import-asset',()=>({importProjectAsset:vi.fn(),writeImportedAsset:vi.fn()}));
vi.mock('@/lib/storage/projects',()=>({newId:()=>`turn-${++mocks.counter}`}));
vi.mock('@/lib/store',()=>({useApp:{getState:()=>({mediaLab:{url:'https://private.example'}})}}));
import { captureLibrarySnapshot } from '@/lib/library-reuse';
import { buildLibrarySection } from '@/lib/library-reuse-core';
beforeEach(()=>{vi.resetAllMocks();mocks.local.mockResolvedValue([]);mocks.remote.mockResolvedValue([]);});
it('bounds metadata without hiding the latest item from another source',async()=>{
 mocks.local.mockResolvedValue(Array.from({length:50},(_,i)=>({id:`local-${i}`,kind:'video',prompt:`Local ${i}`,createdAt:1000+i,mimeType:'video/mp4'})));
 mocks.remote.mockResolvedValue([{id:'remote',kind:'video',title:'Remote latest',createdAt:1,fileName:'clip.webm',serverUrl:'https://private.example'}]);
 const snapshot=await captureLibrarySnapshot();
 expect(snapshot.offers).toHaveLength(6);
 expect(snapshot.offers[0].title).toBe('Local 49');
 expect(snapshot.offers.some(item=>item.title==='Remote latest')).toBe(true);
 expect(buildLibrarySection(snapshot.offers)).not.toContain('https://private.example');
});
it('does not reuse references across turns',async()=>{
 mocks.local.mockResolvedValue([{id:'local',kind:'image',prompt:'Badge',createdAt:1,mimeType:'image/png'}]);
 const a=await captureLibrarySnapshot();
 const b=await captureLibrarySnapshot();
 expect(a.offers[0].ref).not.toBe(b.offers[0].ref);
 expect(b.sources.has(a.offers[0].ref)).toBe(false);
});
it('reports unavailable server metadata while retaining the device library',async()=>{
 mocks.local.mockResolvedValue([{id:'local',kind:'image',prompt:'Badge',createdAt:1,mimeType:'image/png'}]);
 mocks.remote.mockRejectedValue(new Error('contains-private-url-or-ticket'));
 const snapshot=await captureLibrarySnapshot();
 expect(snapshot.offers).toHaveLength(1);
 expect(snapshot.unavailable.join(' ')).toContain('server library is unavailable');
 expect(buildLibrarySection(snapshot.offers,snapshot.unavailable)).not.toContain('contains-private');
});

it('finds an older server creation by its original prompt and supplies bounded descriptive context',async()=>{
 mocks.remote.mockResolvedValue([
  {id:'older',kind:'video',title:'Generation 12',prompt:'Forest waterfall at dawn https://private.example/file '+ 'x'.repeat(1000),createdAt:1,fileName:'older.mp4'},
  ...Array.from({length:8},(_,i)=>({id:`new-${i}`,kind:'video',title:`Generation ${i+13}`,prompt:'City traffic',createdAt:i+2,fileName:`new-${i}.mp4`}))
 ]);
 const snapshot=await captureLibrarySnapshot('Use my forest waterfall video');
 expect(snapshot.offers).toHaveLength(5);
 const found=snapshot.offers.find(item=>item.title==='Generation 12');expect(found).toBeDefined();
 expect(snapshot.sources.get(found!.ref)?.remote?.id).toBe('older');
 const section=buildLibrarySection(snapshot.offers);
 expect(section).toContain('\"matchedTerms\":[\"forest\",\"waterfall\"]');
 expect(section).not.toContain('Forest waterfall at dawn');expect(section).not.toContain('https://private.example');
 expect(section).not.toContain('x'.repeat(501));
});
