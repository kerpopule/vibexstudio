import {afterEach, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({task: null as null | (() => Promise<unknown>), settle: vi.fn(async () => [])}));
vi.mock('expo-background-task', () => ({BackgroundTaskResult:{Success:1}}));
vi.mock('expo-task-manager', () => ({defineTask: (_name: string, task: () => Promise<unknown>) => {state.task=task;}}));
vi.mock('react-native', () => ({AppState:{},Platform:{OS:'web'}}));
vi.mock('@/lib/chat-engine', () => ({useChat:{getState:()=>({})}}));
vi.mock('@/lib/medialab-tool', () => ({settleFinishedMediaJobs:state.settle}));
vi.mock('@/lib/notifications', () => ({notifyWithData:vi.fn()}));
vi.mock('@/lib/store', () => ({useApp:{getState:()=>({mediaLab:{url:'https://lab.example'},projects:[]})}}));
vi.mock('@react-native-async-storage/async-storage', () => ({default:{getItem:async()=>null}}));
afterEach(() => {vi.unstubAllGlobals(); vi.resetModules(); state.settle.mockClear(); state.task=null;});

it('background watcher never requests legacy queue on an explicitly independent host', async () => {
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({vibexStudio:{version:1,legacyQueue:false}})));
  vi.stubGlobal('fetch',fetcher);
  await import('@/lib/media-server-watch');
  await state.task!();
  await state.task!();
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledWith('https://lab.example/manifest.json',expect.any(Object));
  expect(state.settle).not.toHaveBeenCalled();
});

it('background watcher still settles legacy project jobs on an older server', async () => {
  const history=[{id:'old-job',status:'running'}];
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}'))
    .mockResolvedValueOnce(new Response(JSON.stringify({history})));
  vi.stubGlobal('fetch',fetcher);
  await import('@/lib/media-server-watch');
  await state.task!();
  expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['https://lab.example/manifest.json','https://lab.example/api/queue']);
  expect(state.settle).toHaveBeenCalledWith('https://lab.example',history);
});
