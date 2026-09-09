import {beforeEach, expect, it, vi} from 'vitest';
import {advanceMusicRequest, listMusicRequests, markMusicSaved, prepareMusicRequest} from '@/lib/music-workflow';
const mocks = vi.hoisted(() => ({storage:new Map<string,string>(), next:1, submit:vi.fn(), read:vi.fn(), set:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage', () => ({default:{
  getItem:async (key: string) => mocks.storage.get(key) ?? null,
  setItem:(key: string,value: string) => mocks.set(key,value),
  getAllKeys:async () => [...mocks.storage.keys()],
  multiGet:async (keys: string[]) => keys.map((key) => [key,mocks.storage.get(key) ?? null]),
}}));
vi.mock('expo-crypto', () => ({getRandomBytes:(size: number) => new Uint8Array(size).fill(mocks.next++)}));
vi.mock('@/lib/remote-generation', () => ({submitMusicJob:mocks.submit, readMusicJob:mocks.read, MUSIC_PROMPT_LIMIT:600, MUSIC_LYRICS_LIMIT:4000, MUSIC_MIN_SECONDS:10}));
const origin = 'https://media.example';
const engine = {id:'acestep-gpu' as const,revision:'music-rev',operation:'compose' as const,maxSeconds:120};
const job = {id:'d'.repeat(32),kind:'audio' as const,status:'queued' as const,createdAt:1,updatedAt:1};
beforeEach(() => {
  mocks.storage.clear();mocks.next=1;vi.clearAllMocks();
  mocks.set.mockImplementation(async (key: string,value: string) => {mocks.storage.set(key,value);});
  mocks.submit.mockResolvedValue(job);mocks.read.mockResolvedValue(job);
});

it('persists the exact description, lyrics, length and seed before submission and recovers a lost reply by request id', async () => {
  const prepared = await prepareMusicRequest(origin,engine,'  calm piano  ','',20,7);
  expect(prepared.prompt).toBe('calm piano'); expect(prepared.lyrics).toBe(''); expect(prepared.seconds).toBe(20); expect(prepared.seed).toBe(7);
  expect(mocks.submit).not.toHaveBeenCalled();
  mocks.submit.mockRejectedValueOnce(new Error('response lost'));
  await expect(advanceMusicRequest(prepared.requestId)).rejects.toThrow('response lost');
  vi.resetModules();
  const resumed = await import('@/lib/music-workflow');
  await resumed.advanceMusicRequest(prepared.requestId);
  expect(mocks.submit.mock.calls[0]).toEqual(mocks.submit.mock.calls[1]);
  expect(mocks.submit.mock.calls[1]).toEqual([origin,prepared.requestId,engine,'calm piano','',20,7]);
  expect((await resumed.listMusicRequests(origin))[0].job?.id).toBe(job.id);
});

it('refuses empty descriptions and out-of-range lengths without touching the server', async () => {
  await expect(prepareMusicRequest(origin,engine,'   ','',20)).rejects.toThrow('600');
  await expect(prepareMusicRequest(origin,engine,'x','',5)).rejects.toThrow('10');
  await expect(prepareMusicRequest(origin,engine,'x','',300)).rejects.toThrow('120');
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(await listMusicRequests(origin)).toEqual([]);
});

it('keeps cancellation intent across failure and sends it after acceptance recovery', async () => {
  const prepared = await prepareMusicRequest(origin,engine,'cancel me','',20);
  mocks.submit.mockRejectedValueOnce(new Error('offline'));
  await expect(advanceMusicRequest(prepared.requestId,true)).rejects.toThrow('offline');
  expect((await listMusicRequests(origin))[0].cancelRequested).toBe(true);
  mocks.read.mockResolvedValue({...job,status:'cancel_requested'});
  await advanceMusicRequest(prepared.requestId);
  expect(mocks.read).toHaveBeenLastCalledWith(origin,job.id,true);
});

it('remembers a Library save and rejects records for a different engine', async () => {
  const prepared = await prepareMusicRequest(origin,engine,'saved','',20);
  await markMusicSaved(prepared.requestId,'import-abc-wav');
  expect((await listMusicRequests(origin))[0].libraryAssetId).toBe('import-abc-wav');
  const raw = JSON.parse(mocks.storage.get('vibex.music.v1.'+prepared.requestId)!);
  mocks.storage.set('vibex.music.v1.'+prepared.requestId,JSON.stringify({...raw,engine:{...raw.engine,id:'other'}}));
  await expect(listMusicRequests(origin)).rejects.toThrow('could not be read');
});
