import {beforeEach, expect, it, vi} from 'vitest';
import {advanceImageRequest, listImageRequests, markImageSaved, prepareImageRequest} from '@/lib/image-workflow';
const mocks = vi.hoisted(() => ({storage:new Map<string,string>(), next:1, submit:vi.fn(), read:vi.fn(), set:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage', () => ({default:{
  getItem:async (key: string) => mocks.storage.get(key) ?? null,
  setItem:(key: string,value: string) => mocks.set(key,value),
  getAllKeys:async () => [...mocks.storage.keys()],
  multiGet:async (keys: string[]) => keys.map((key) => [key,mocks.storage.get(key) ?? null]),
}}));
vi.mock('expo-crypto', () => ({getRandomBytes:(size: number) => new Uint8Array(size).fill(mocks.next++)}));
vi.mock('@/lib/remote-generation', () => ({submitImageJob:mocks.submit, readImageJob:mocks.read, IMAGE_PROMPT_LIMIT:600}));
const origin = 'https://media.example';
const engine = {id:'zimage-turbo-gpu' as const,revision:'image-rev',operation:'text-to-image' as const,sizes:['1024*1024','1280*768','768*1280']};
const job = {id:'d'.repeat(32),kind:'image' as const,status:'queued' as const,createdAt:1,updatedAt:1};
beforeEach(() => {
  mocks.storage.clear();mocks.next=1;vi.clearAllMocks();
  mocks.set.mockImplementation(async (key: string,value: string) => {mocks.storage.set(key,value);});
  mocks.submit.mockResolvedValue(job);mocks.read.mockResolvedValue(job);
});

it('persists the exact description, size and seed before submission and recovers a lost reply by request id', async () => {
  const prepared = await prepareImageRequest(origin,engine,'  sleeping cat  ','1024*1024',7);
  expect(prepared.prompt).toBe('sleeping cat'); expect(prepared.size).toBe('1024*1024'); expect(prepared.seed).toBe(7);
  expect(mocks.submit).not.toHaveBeenCalled();
  mocks.submit.mockRejectedValueOnce(new Error('response lost'));
  await expect(advanceImageRequest(prepared.requestId)).rejects.toThrow('response lost');
  vi.resetModules();
  const resumed = await import('@/lib/image-workflow');
  await resumed.advanceImageRequest(prepared.requestId);
  expect(mocks.submit.mock.calls[0]).toEqual(mocks.submit.mock.calls[1]);
  expect(mocks.submit.mock.calls[1]).toEqual([origin,prepared.requestId,engine,'sleeping cat','1024*1024',7]);
  expect((await resumed.listImageRequests(origin))[0].job?.id).toBe(job.id);
});

it('refuses empty descriptions and unknown sizes without touching the server', async () => {
  await expect(prepareImageRequest(origin,engine,'   ','1024*1024')).rejects.toThrow('600');
  await expect(prepareImageRequest(origin,engine,'x','512*512')).rejects.toThrow('size');
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(await listImageRequests(origin)).toEqual([]);
});

it('keeps cancellation intent across failure and sends it after acceptance recovery', async () => {
  const prepared = await prepareImageRequest(origin,engine,'cancel me','1024*1024');
  mocks.submit.mockRejectedValueOnce(new Error('offline'));
  await expect(advanceImageRequest(prepared.requestId,true)).rejects.toThrow('offline');
  expect((await listImageRequests(origin))[0].cancelRequested).toBe(true);
  mocks.read.mockResolvedValue({...job,status:'cancel_requested'});
  await advanceImageRequest(prepared.requestId);
  expect(mocks.read).toHaveBeenLastCalledWith(origin,job.id,true);
});

it('remembers a Library save and rejects records for a different engine', async () => {
  const prepared = await prepareImageRequest(origin,engine,'saved','1024*1024');
  await markImageSaved(prepared.requestId,'import-abc-png');
  expect((await listImageRequests(origin))[0].libraryAssetId).toBe('import-abc-png');
  const raw = JSON.parse(mocks.storage.get('vibex.image.v1.'+prepared.requestId)!);
  mocks.storage.set('vibex.image.v1.'+prepared.requestId,JSON.stringify({...raw,engine:{...raw.engine,id:'other'}}));
  await expect(listImageRequests(origin)).rejects.toThrow('could not be read');
});
