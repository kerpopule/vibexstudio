import {beforeEach, expect, it, vi} from 'vitest';
import type {RemoteLibraryAsset} from '@/lib/library-core';
import {advanceBackgroundRequest, listBackgroundRequests, prepareBackgroundRequest} from '@/lib/background-workflow';
const mocks = vi.hoisted(() => ({storage:new Map<string,string>(), next:1, snapshot:vi.fn(), submit:vi.fn(), cancel:vi.fn(), read:vi.fn(), set:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage', () => ({default:{
  getItem:async (key: string) => mocks.storage.get(key) ?? null,
  setItem:(key: string,value: string) => mocks.set(key,value),
  getAllKeys:async () => [...mocks.storage.keys()],
  multiGet:async (keys: string[]) => keys.map((key) => [key,mocks.storage.get(key) ?? null]),
}}));
vi.mock('expo-crypto', () => ({getRandomBytes:(size: number) => new Uint8Array(size).fill(mocks.next++)}));
vi.mock('@/lib/remote-generation', () => ({snapshotRemoteImage:mocks.snapshot, submitBackgroundJob:mocks.submit, cancelBackgroundRequest:mocks.cancel, readStudioJob:mocks.read}));
const origin = 'https://media.example';
const asset = {id:'image-one',title:'My game character',serverUrl:origin,mimeType:'image/png'} as RemoteLibraryAsset;
const engine = {id:'birefnet-cpu',revision:'exact-revision',operation:'remove-background' as const};
const input = {id:'b'.repeat(32),sha256:'c'.repeat(64),bytes:100,width:4,height:3};
const job = {id:'d'.repeat(32),kind:'image',status:'queued',createdAt:1,updatedAt:1};
beforeEach(() => {
  mocks.storage.clear();mocks.next=1;vi.clearAllMocks();
  mocks.set.mockImplementation(async (key: string,value: string) => {mocks.storage.set(key,value);});
  mocks.cancel.mockResolvedValue({...job,status:'cancelled'});mocks.snapshot.mockResolvedValue(input);mocks.submit.mockResolvedValue(job);mocks.read.mockResolvedValue(job);
});

it('saves the exact input before submission and recovers a lost response after reload', async () => {
  const prepared = await prepareBackgroundRequest(asset,engine);
  expect(mocks.submit).not.toHaveBeenCalled();
  expect((await listBackgroundRequests(origin))[0]).toEqual(prepared);
  mocks.submit.mockRejectedValueOnce(new Error('response lost'));
  await expect(advanceBackgroundRequest(prepared.requestId)).rejects.toThrow('response lost');
  vi.resetModules();
  const resumed = await import('@/lib/background-workflow');
  await resumed.advanceBackgroundRequest(prepared.requestId);
  expect(mocks.submit.mock.calls[0]).toEqual(mocks.submit.mock.calls[1]);
  expect(mocks.submit.mock.calls[1]).toEqual([origin,prepared.requestId,engine,input]);
  expect((await resumed.listBackgroundRequests(origin))[0].job?.id).toBe(job.id);
});

it('persists unknown-acceptance cancellation across a lost response without submitting', async () => {
  const prepared = await prepareBackgroundRequest(asset,engine);
  mocks.cancel.mockRejectedValueOnce(new Error('offline'));
  await expect(advanceBackgroundRequest(prepared.requestId,true)).rejects.toThrow('offline');
  expect((await listBackgroundRequests(origin))[0].cancelRequested).toBe(true);
  vi.resetModules();
  const resumed = await import('@/lib/background-workflow');
  expect((await resumed.advanceBackgroundRequest(prepared.requestId)).job?.status).toBe('cancelled');
  expect(mocks.cancel.mock.calls).toEqual(Array(2).fill([origin,prepared.requestId,engine,input]));
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});

it('does not submit when durable local storage fails', async () => {
  mocks.set.mockRejectedValueOnce(new Error('storage full'));
  await expect(prepareBackgroundRequest(asset,engine)).rejects.toThrow('storage full');
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(await listBackgroundRequests(origin)).toEqual([]);
});

it('serializes duplicate polling and preserves separate requests without list overwrites', async () => {
  const [first,duplicate] = await Promise.all([prepareBackgroundRequest(asset,engine),prepareBackgroundRequest(asset,engine)]);
  expect(duplicate).toEqual(first);
  expect(await prepareBackgroundRequest(asset,engine)).toEqual(first);
  expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  const second = await prepareBackgroundRequest({...asset,id:'image-two'},engine);
  await Promise.all([advanceBackgroundRequest(first.requestId),advanceBackgroundRequest(first.requestId)]);
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect((await listBackgroundRequests(origin)).map((item) => item.requestId).sort()).toEqual([first.requestId,second.requestId].sort());
  expect(await listBackgroundRequests('https://another.example')).toEqual([]);
});

it('stops polling terminal jobs and never stores an access token', async () => {
  const prepared = await prepareBackgroundRequest(asset,engine);
  mocks.read.mockResolvedValue({...job,status:'succeeded'});
  await advanceBackgroundRequest(prepared.requestId);
  await advanceBackgroundRequest(prepared.requestId);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect([...mocks.storage.values()].join('')).not.toMatch(/token|authorization/i);
});

it('keeps stable agent requests separate from manual jobs and rejects changed retry arguments',async()=>{
  const {prepareAgentBackgroundRequest}=await import('@/lib/background-workflow');
  const owner='a'.repeat(24),id='e'.repeat(32);
  const first=await prepareAgentBackgroundRequest(asset,engine,owner,id);
  expect(first.agentOwner).toBe(owner);
  const manual=await prepareBackgroundRequest(asset,engine);
  expect(manual.requestId).not.toBe(id);
  await expect(prepareAgentBackgroundRequest({...asset,id:'another'},engine,owner,id)).rejects.toThrow('different media');
  await expect(prepareAgentBackgroundRequest(asset,engine,'b'.repeat(24),id)).rejects.toThrow('different media');
  mocks.submit.mockRejectedValueOnce(new Error('lost response'));
  await expect(advanceBackgroundRequest(id)).rejects.toThrow('lost response');
  vi.resetModules();
  const resumed=await import('@/lib/background-workflow');
  expect(await resumed.prepareAgentBackgroundRequest(asset,engine,owner,id)).toEqual(first);
  await resumed.advanceBackgroundRequest(id);
  expect(mocks.submit.mock.calls[0]).toEqual(mocks.submit.mock.calls[1]);
  expect(mocks.snapshot).toHaveBeenCalledTimes(2);
});

it('serializes matching agent preparations and refuses a concurrent conflicting request',async()=>{
  const {prepareAgentBackgroundRequest}=await import('@/lib/background-workflow');
  const owner='a'.repeat(24),id='f'.repeat(32);
  const results=await Promise.allSettled([
    prepareAgentBackgroundRequest(asset,engine,owner,id),
    prepareAgentBackgroundRequest(asset,engine,owner,id),
    prepareAgentBackgroundRequest({...asset,id:'other'},engine,owner,id),
  ]);
  expect(results.map(result=>result.status)).toEqual(['fulfilled','fulfilled','rejected']);
  expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  expect(mocks.submit).not.toHaveBeenCalled();
});
