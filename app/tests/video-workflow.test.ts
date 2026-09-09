import {beforeEach, expect, it, vi} from 'vitest';
import {advanceVideoRequest, listVideoRequests, markVideoSaved, prepareVideoRequest} from '@/lib/video-workflow';
const mocks = vi.hoisted(() => ({storage:new Map<string,string>(), next:1, submit:vi.fn(), read:vi.fn(), set:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage', () => ({default:{
  getItem:async (key: string) => mocks.storage.get(key) ?? null,
  setItem:(key: string,value: string) => mocks.set(key,value),
  getAllKeys:async () => [...mocks.storage.keys()],
  multiGet:async (keys: string[]) => keys.map((key) => [key,mocks.storage.get(key) ?? null]),
}}));
vi.mock('expo-crypto', () => ({getRandomBytes:(size: number) => new Uint8Array(size).fill(mocks.next++)}));
vi.mock('@/lib/remote-generation', () => ({submitVideoJob:mocks.submit, readVideoJob:mocks.read, VIDEO_PROMPT_LIMIT:600, VIDEO_MIN_FRAMES:9}));
const origin = 'https://media.example';
const engine = {id:'wan22-ti2v-5b-gpu' as const,revision:'video-rev',operation:'text-to-video' as const,maxFrames:121,fps:24,sizes:['704*1280','1280*704']};
const job = {id:'d'.repeat(32),kind:'video' as const,status:'queued' as const,createdAt:1,updatedAt:1};
beforeEach(() => {
  mocks.storage.clear();mocks.next=1;vi.clearAllMocks();
  mocks.set.mockImplementation(async (key: string,value: string) => {mocks.storage.set(key,value);});
  mocks.submit.mockResolvedValue(job);mocks.read.mockResolvedValue(job);
});

it('persists the exact description, length, size and seed before submission and recovers a lost reply by request id', async () => {
  const prepared = await prepareVideoRequest(origin,engine,'  paper boat  ',25,'704*1280',7);
  expect(prepared.prompt).toBe('paper boat'); expect(prepared.frames).toBe(25); expect(prepared.size).toBe('704*1280'); expect(prepared.seed).toBe(7);
  expect(mocks.submit).not.toHaveBeenCalled();
  mocks.submit.mockRejectedValueOnce(new Error('response lost'));
  await expect(advanceVideoRequest(prepared.requestId)).rejects.toThrow('response lost');
  vi.resetModules();
  const resumed = await import('@/lib/video-workflow');
  await resumed.advanceVideoRequest(prepared.requestId);
  expect(mocks.submit.mock.calls[0]).toEqual(mocks.submit.mock.calls[1]);
  expect(mocks.submit.mock.calls[1]).toEqual([origin,prepared.requestId,engine,'paper boat',25,'704*1280',7]);
  expect((await resumed.listVideoRequests(origin))[0].job?.id).toBe(job.id);
});

it('refuses empty descriptions, non-4n+1 lengths and unknown sizes without touching the server', async () => {
  await expect(prepareVideoRequest(origin,engine,'   ',25,'704*1280')).rejects.toThrow('600');
  await expect(prepareVideoRequest(origin,engine,'x',24,'704*1280')).rejects.toThrow('length');
  await expect(prepareVideoRequest(origin,engine,'x',125,'704*1280')).rejects.toThrow('length');
  await expect(prepareVideoRequest(origin,engine,'x',25,'512*512')).rejects.toThrow('size');
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(await listVideoRequests(origin)).toEqual([]);
});

it('keeps cancellation intent across failure and sends it after acceptance recovery', async () => {
  const prepared = await prepareVideoRequest(origin,engine,'cancel me',25,'704*1280');
  mocks.submit.mockRejectedValueOnce(new Error('offline'));
  await expect(advanceVideoRequest(prepared.requestId,true)).rejects.toThrow('offline');
  expect((await listVideoRequests(origin))[0].cancelRequested).toBe(true);
  mocks.read.mockResolvedValue({...job,status:'cancel_requested'});
  await advanceVideoRequest(prepared.requestId);
  expect(mocks.read).toHaveBeenLastCalledWith(origin,job.id,true);
});

it('remembers a Library save and rejects records for a different engine', async () => {
  const prepared = await prepareVideoRequest(origin,engine,'saved',25,'704*1280');
  await markVideoSaved(prepared.requestId,'import-abc-mp4');
  expect((await listVideoRequests(origin))[0].libraryAssetId).toBe('import-abc-mp4');
  const raw = JSON.parse(mocks.storage.get('vibex.video.v1.'+prepared.requestId)!);
  mocks.storage.set('vibex.video.v1.'+prepared.requestId,JSON.stringify({...raw,engine:{...raw.engine,id:'other'}}));
  await expect(listVideoRequests(origin)).rejects.toThrow('could not be read');
});
