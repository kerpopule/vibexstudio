import {beforeEach, expect, it, vi} from 'vitest';
import {advanceSpeechRequest, listSpeechRequests, markSpeechSaved, prepareSpeechRequest} from '@/lib/speech-workflow';
const mocks = vi.hoisted(() => ({storage:new Map<string,string>(), next:1, submit:vi.fn(), read:vi.fn(), set:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage', () => ({default:{
  getItem:async (key: string) => mocks.storage.get(key) ?? null,
  setItem:(key: string,value: string) => mocks.set(key,value),
  getAllKeys:async () => [...mocks.storage.keys()],
  multiGet:async (keys: string[]) => keys.map((key) => [key,mocks.storage.get(key) ?? null]),
}}));
vi.mock('expo-crypto', () => ({getRandomBytes:(size: number) => new Uint8Array(size).fill(mocks.next++)}));
vi.mock('@/lib/remote-generation', () => ({submitSpeechJob:mocks.submit, readSpeechJob:mocks.read, SPEECH_TEXT_LIMIT:600}));
const origin = 'https://media.example';
const engine = {id:'chatterbox-english-cpu' as const,revision:'speech-rev',operation:'speak' as const,voice:'upstream-default-english' as const,language:'en' as const};
const job = {id:'d'.repeat(32),kind:'audio' as const,status:'queued' as const,createdAt:1,updatedAt:1};
beforeEach(() => {
  mocks.storage.clear();mocks.next=1;vi.clearAllMocks();
  mocks.set.mockImplementation(async (key: string,value: string) => {mocks.storage.set(key,value);});
  mocks.submit.mockResolvedValue(job);mocks.read.mockResolvedValue(job);
});

it('persists exact text and seed before submission and recovers a lost reply by request id', async () => {
  const prepared = await prepareSpeechRequest(origin,engine,'  Welcome to your creative studio.  ');
  expect(prepared.text).toBe('Welcome to your creative studio.');
  expect(prepared.seed).toBe(7);
  expect(mocks.submit).not.toHaveBeenCalled();
  mocks.submit.mockRejectedValueOnce(new Error('response lost'));
  await expect(advanceSpeechRequest(prepared.requestId)).rejects.toThrow('response lost');
  vi.resetModules();
  const resumed = await import('@/lib/speech-workflow');
  await resumed.advanceSpeechRequest(prepared.requestId);
  expect(mocks.submit.mock.calls[0]).toEqual(mocks.submit.mock.calls[1]);
  expect(mocks.submit.mock.calls[1]).toEqual([origin,prepared.requestId,engine,'Welcome to your creative studio.',7]);
  expect((await resumed.listSpeechRequests(origin))[0].job?.id).toBe(job.id);
});

it('refuses empty or oversized text without touching the server', async () => {
  await expect(prepareSpeechRequest(origin,engine,'   ')).rejects.toThrow('600');
  await expect(prepareSpeechRequest(origin,engine,'x'.repeat(601))).rejects.toThrow('600');
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(await listSpeechRequests(origin)).toEqual([]);
});

it('keeps cancellation intent across failure and sends it after acceptance recovery', async () => {
  const prepared = await prepareSpeechRequest(origin,engine,'Cancel me');
  mocks.submit.mockRejectedValueOnce(new Error('offline'));
  await expect(advanceSpeechRequest(prepared.requestId,true)).rejects.toThrow('offline');
  expect((await listSpeechRequests(origin))[0].cancelRequested).toBe(true);
  mocks.read.mockResolvedValue({...job,status:'cancel_requested'});
  await advanceSpeechRequest(prepared.requestId);
  expect(mocks.read).toHaveBeenLastCalledWith(origin,job.id,true);
});

it('rejects saved records for a different engine or voice', async () => {
  const prepared = await prepareSpeechRequest(origin,engine,'Hello');
  const raw = JSON.parse(mocks.storage.get('vibex.speech.v1.'+prepared.requestId)!);
  mocks.storage.set('vibex.speech.v1.'+prepared.requestId,JSON.stringify({...raw,engine:{...raw.engine,voice:'cloned'}}));
  await expect(listSpeechRequests(origin)).rejects.toThrow('could not be read');
});

it('remembers a Library save on the persisted record and rejects invalid asset ids', async () => {
  const prepared = await prepareSpeechRequest(origin,engine,'Saved line');
  await markSpeechSaved(prepared.requestId,'import-abc-wav');
  expect((await listSpeechRequests(origin))[0].libraryAssetId).toBe('import-abc-wav');
  await expect(markSpeechSaved(prepared.requestId,'../evil')).rejects.toThrow('Invalid');
});
