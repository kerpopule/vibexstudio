import {beforeEach, expect, it, vi} from 'vitest';
import type {ModelSource} from '@/lib/model-workflow';
import {advanceModelRequest, listModelRequests, prepareModelRequest} from '@/lib/model-workflow';
const mocks = vi.hoisted(() => ({storage:new Map<string,string>(), next:1, snapshot:vi.fn(), submit:vi.fn(), read:vi.fn(), set:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage', () => ({default:{
  getItem:async (key: string) => mocks.storage.get(key) ?? null,
  setItem:(key: string,value: string) => mocks.set(key,value),
  getAllKeys:async () => [...mocks.storage.keys()],
  multiGet:async (keys: string[]) => keys.map((key) => [key,mocks.storage.get(key) ?? null]),
}}));
vi.mock('expo-crypto', () => ({getRandomBytes:(size: number) => new Uint8Array(size).fill(mocks.next++)}));
vi.mock('@/lib/remote-generation', () => ({snapshotStudioImage:mocks.snapshot, submitModelJob:mocks.submit, readModelJob:mocks.read}));
const origin = 'https://media.example';
const asset = {id:'a'.repeat(32),title:'My game character',serverUrl:origin,} as ModelSource;
const engine = {id:'triposr-cpu',revision:'exact-revision',operation:'image-to-3d' as const,variant:'exact-variant'};
const input = {id:'b'.repeat(32),sha256:'c'.repeat(64),bytes:100,width:4,height:3};
const job = {id:'d'.repeat(32),kind:'model',status:'queued',createdAt:1,updatedAt:1};
beforeEach(() => {
  mocks.storage.clear();mocks.next=1;vi.clearAllMocks();
  mocks.set.mockImplementation(async (key: string,value: string) => {mocks.storage.set(key,value);});
  mocks.snapshot.mockResolvedValue(input);mocks.submit.mockResolvedValue(job);mocks.read.mockResolvedValue(job);
});

it('saves the exact input before submission and recovers a lost response after reload', async () => {
  const prepared = await prepareModelRequest(asset,engine);
  expect(mocks.submit).not.toHaveBeenCalled();
  expect((await listModelRequests(origin))[0]).toEqual(prepared);
  mocks.submit.mockRejectedValueOnce(new Error('response lost'));
  await expect(advanceModelRequest(prepared.requestId)).rejects.toThrow('response lost');
  vi.resetModules();
  const resumed = await import('@/lib/model-workflow');
  await resumed.advanceModelRequest(prepared.requestId);
  expect(mocks.submit.mock.calls[0]).toEqual(mocks.submit.mock.calls[1]);
  expect(mocks.submit.mock.calls[1]).toEqual([origin,prepared.requestId,engine,input]);
  expect((await resumed.listModelRequests(origin))[0].job?.id).toBe(job.id);
});

it('keeps cancellation intent across failure and sends it after acceptance recovery', async () => {
  const prepared = await prepareModelRequest(asset,engine);
  mocks.submit.mockRejectedValueOnce(new Error('offline'));
  await expect(advanceModelRequest(prepared.requestId,true)).rejects.toThrow('offline');
  expect((await listModelRequests(origin))[0].cancelRequested).toBe(true);
  mocks.read.mockResolvedValue({...job,status:'cancel_requested'});
  await advanceModelRequest(prepared.requestId);
  expect(mocks.read).toHaveBeenLastCalledWith(origin,job.id,true);
});

it('does not submit when durable local storage fails', async () => {
  mocks.set.mockRejectedValueOnce(new Error('storage full'));
  await expect(prepareModelRequest(asset,engine)).rejects.toThrow('storage full');
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(await listModelRequests(origin)).toEqual([]);
});

it('serializes duplicate polling and preserves separate requests without list overwrites', async () => {
  const [first,duplicate] = await Promise.all([prepareModelRequest(asset,engine),prepareModelRequest(asset,engine)]);
  expect(duplicate).toEqual(first);
  expect(await prepareModelRequest(asset,engine)).toEqual(first);
  expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  const second = await prepareModelRequest({...asset,id:'e'.repeat(32)},engine);
  await Promise.all([advanceModelRequest(first.requestId),advanceModelRequest(first.requestId)]);
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect((await listModelRequests(origin)).map((item) => item.requestId).sort()).toEqual([first.requestId,second.requestId].sort());
  expect(await listModelRequests('https://another.example')).toEqual([]);
});

it('stops polling terminal jobs and never stores an access token', async () => {
  const prepared = await prepareModelRequest(asset,engine);
  mocks.read.mockResolvedValue({...job,status:'succeeded'});
  await advanceModelRequest(prepared.requestId);
  await advanceModelRequest(prepared.requestId);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect([...mocks.storage.values()].join('')).not.toMatch(/token|authorization/i);
});


it('keeps requests for different variants separate and snapshots the owned source job', async () => {
  const first = await prepareModelRequest(asset,engine);
  const second = await prepareModelRequest(asset,{...engine,variant:'other-explicit-variant'});
  expect(first.requestId).not.toBe(second.requestId);
  expect(mocks.snapshot).toHaveBeenCalledWith(origin,asset.id);
  expect((await listModelRequests(origin)).map(item => item.engine.variant).sort()).toEqual(['exact-variant','other-explicit-variant']);
});
