import {beforeEach, expect, it, vi} from 'vitest';
import {performPair} from '@/lib/pair-actions';
const mocks = vi.hoisted(() => ({workbench:vi.fn(),media:vi.fn(),saveWorkbench:vi.fn(),saveMedia:vi.fn(),claim:vi.fn()}));
vi.mock('@/lib/media-pairing', () => ({probeMediaLab:mocks.media}));
vi.mock('@/lib/workbench', () => ({probeWorkbench:mocks.workbench}));
vi.mock('@/lib/device-enrollment',async(importOriginal)=>{const actual=await importOriginal<typeof import('../src/lib/device-enrollment')>();return {...actual,claimWorkbenchInvite:mocks.claim};});
vi.mock('@/lib/store', () => ({useApp:{getState:()=>({pairWorkbench:mocks.saveWorkbench,setMediaLab:mocks.saveMedia})}}));
const payload = {workbench:{url:'https://build.example',token:'private-token'},mediaLab:'https://media.example'};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workbench.mockResolvedValue({ok:true});
  mocks.media.mockResolvedValue(true);
});
it('continues Media Lab pairing after Workbench storage fails', async () => {
  mocks.saveWorkbench.mockRejectedValue(new Error('private-token'));
  const result = await performPair(payload);
  expect(result.workbench?.ok).toBe(false);
  expect(result.mediaLab?.ok).toBe(true);
  expect(mocks.saveMedia).toHaveBeenCalledWith(expect.objectContaining({url:payload.mediaLab}));
  expect(result.workbench?.reason).toContain('could not save its connection securely');
  expect(JSON.stringify(result)).not.toContain('private-token');
});
it('reports storage failure rather than success after a successful Media Lab probe', async () => {
  mocks.saveMedia.mockRejectedValue(new Error('storage unavailable'));
  const result = await performPair(payload);
  expect(result.workbench?.ok).toBe(true);
  expect(result.mediaLab?.ok).toBe(false);
  expect(result.mediaLab?.reason).toContain('could not save the connection');
});
it('reports both rejected probes and never writes a connection', async () => {
  mocks.workbench.mockRejectedValue(new Error('offline'));
  mocks.media.mockRejectedValue(new Error('offline'));
  const result = await performPair(payload);
  expect(result.workbench?.ok).toBe(false);
  expect(result.mediaLab?.ok).toBe(false);
  expect(mocks.saveWorkbench).not.toHaveBeenCalled();
  expect(mocks.saveMedia).not.toHaveBeenCalled();
});

it('exchanges a one-time invitation and saves only the returned device token',async()=>{
 mocks.claim.mockResolvedValue('device-token');
 const result=await performPair({mediaLab:null,workbench:{url:'https://build.example',invitation:'invite'}});
 expect(result.workbench?.ok).toBe(true);expect(mocks.saveWorkbench).toHaveBeenCalledWith('https://build.example','device-token');
 expect(mocks.workbench).toHaveBeenCalledWith('https://build.example','device-token');expect(JSON.stringify(result)).not.toContain('device-token');
});
