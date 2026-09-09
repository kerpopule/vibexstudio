import {beforeEach, expect, it, vi} from 'vitest';
import {loadEntries,matchesLibrarySearch} from '@/lib/library-entries';
const source=vi.hoisted(()=>({device:vi.fn(),server:vi.fn()}));
vi.mock('@/lib/storage/media-gallery',()=>({listGallery:source.device}));
vi.mock('@/lib/remote-library',()=>({listRemoteLibrary:source.server}));
const local={id:'same-id',kind:'image',createdAt:1,prompt:'Device image',uri:'file:///fixture'};
const remote={id:'same-id',kind:'audio',createdAt:2,title:'Server audio',serverUrl:'http://fixture'};
beforeEach(()=>{vi.resetAllMocks();source.device.mockResolvedValue([local]);source.server.mockResolvedValue([remote]);});
it('combines both sources with stable distinct IDs and newest first',async()=>{
  const result=await loadEntries('http://fixture');
  expect(result.items.map(item=>item.id)).toEqual(['server-same-id','device-same-id']);
  expect(result.items[0].remote).toEqual(remote);
  expect(result.items[1].uri).toBe(local.uri);
  expect(result.deviceError).toBeNull();expect(result.remoteError).toBeNull();
});
it('loads the server even when device storage fails, and recovers on retry',async()=>{
  source.device.mockRejectedValueOnce(new Error('private storage diagnostic'));
  const result=await loadEntries('http://fixture');
  expect(result.items.map(item=>item.id)).toEqual(['server-same-id']);
  expect(result.deviceError).toContain('Refresh Library');
  expect(result.deviceError).not.toContain('private');
  expect((await loadEntries('http://fixture')).items).toHaveLength(2);
});
it('keeps device assets when the server fails',async()=>{
  source.server.mockRejectedValueOnce(new Error('Server offline'));
  const result=await loadEntries('http://fixture');
  expect(result.items.map(item=>item.id)).toEqual(['device-same-id']);
  expect(result.remoteError).toBe('Server offline');
});
it('makes no server request when no server is connected',async()=>{
  expect((await loadEntries()).items).toHaveLength(1);
  expect(source.server).not.toHaveBeenCalled();
});

it('searches original server prompts as well as titles, with no media download',async()=>{
 source.server.mockResolvedValue([{...remote,title:'Generation 12',prompt:'Forest waterfall at dawn',fileName:'waterfall.wav',providerLabel:'My server'}]);
 const {items}=await loadEntries('http://fixture');
 expect(items.filter(item=>matchesLibrarySearch(item,['forest','waterfall'])).map(item=>item.id)).toEqual(['server-same-id']);
 expect(matchesLibrarySearch(items[0],['generation','dawn'])).toBe(true);
 expect(matchesLibrarySearch(items[0],['city'])).toBe(false);
 expect(matchesLibrarySearch(items[1],['device','image'])).toBe(true);
});
