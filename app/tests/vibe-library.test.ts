import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({stream:vi.fn(), readRemote:vi.fn(), writeFile:vi.fn(), writeBinary:vi.fn(), writeChat:vi.fn(), generated:vi.fn(), readLocal:vi.fn(), importLocal:vi.fn()}));
vi.mock('@/lib/ai/chat',()=>({streamChat:mocks.stream}));
vi.mock('@/lib/ai/web-tools',()=>({executeWebRequests:vi.fn()}));
vi.mock('@/lib/medialab-tool',()=>({getMediaLabPromptContext:async()=>null,handleMediaRequests:mocks.generated}));
vi.mock('@/lib/storage/projects',()=>({newId:()=> 'current-turn',listFiles:async()=>[],listProjectFilePaths:async()=>[],readChat:async()=>[],writeChat:mocks.writeChat,writeFile:mocks.writeFile}));
vi.mock('@/lib/storage/import-asset',()=>({writeImportedAsset:mocks.writeBinary,importProjectAsset:mocks.importLocal}));
vi.mock('@/lib/store',()=>({useApp:{getState:()=>({mediaLab:{url:'https://private-spark.example'}})}}));
vi.mock('@/lib/storage/media-gallery',()=>({listGalleryMetadata:async()=>[{id:'old-local',kind:'video',prompt:'Old video',createdAt:100,mimeType:'video/mp4'}],readGalleryItem:mocks.readLocal}));
vi.mock('@/lib/remote-library',()=>({listRemoteLibrary:async()=>[{id:'latest-server-video',kind:'video',title:'Victory',createdAt:200,fileName:'win.webm',mimeType:'video/webm',bytes:3,serverUrl:'https://private-spark.example',providerLabel:'engine',prompt:'private description'}],readRemoteAsset:mocks.readRemote}));
import { runVibeTurn } from '@/lib/vibe';
import type { ProjectMeta, ProviderConnection } from '@/lib/types';
const run=()=>runVibeTurn({project:{id:'p',name:'Game'} as ProjectMeta,userText:'Use my latest video when I win the game',connection:{} as ProviderConnection,secret:'provider-secret',model:'test',callbacks:{onStream:vi.fn(),onMessages:vi.fn(),onFilesChanged:vi.fn()}});
beforeEach(()=>{vi.resetAllMocks();mocks.readRemote.mockResolvedValue(new Uint8Array([1,2,3]));});
describe('builder reuse execution',()=>{
 it('offers the latest video, imports its real bytes, and writes code using a project-relative path',async()=>{
  mocks.stream.mockImplementation(async({system})=>{
   expect(system).not.toContain('https://private-spark.example');
   expect(system).not.toContain('provider-secret');
   expect(system).not.toContain('private description');
   const ref=system.match(/"ref":"([^"]+)"/)[1];
   return '```asset id='+ref+' file=assets/win.webm\n```\n```js file=game.js\nfunction win(){video.src="assets/win.webm";video.play();}\n```';
  });
  await run();
  expect(mocks.readRemote).toHaveBeenCalledWith(expect.objectContaining({id:'latest-server-video'}),undefined);
  expect(mocks.writeBinary).toHaveBeenCalledWith('p','assets/win.webm',new Uint8Array([1,2,3]));
  expect(mocks.writeFile).toHaveBeenCalledWith('p','game.js',expect.stringContaining('assets/win.webm'));
  expect(mocks.generated).not.toHaveBeenCalled();
  expect(mocks.stream).toHaveBeenCalledTimes(1);
 });
 it('does not change app code if the requested asset fails to download',async()=>{
  mocks.stream.mockResolvedValue('```asset id=asset_current-turn_1 file=assets/win.webm\n```\n```js file=game.js\nplayNewVideo();\n```');
  mocks.readRemote.mockRejectedValue(new Error('offline'));
  await run();
  expect(mocks.writeFile).not.toHaveBeenCalled();
  expect(mocks.writeBinary).not.toHaveBeenCalled();
  expect(mocks.writeChat.mock.calls.at(-1)?.[1].at(-1).text).toContain('Could not import');
 });
 it('rejects invented refs before downloading or writing any output',async()=>{
  mocks.stream.mockResolvedValue('```asset id=asset_old-turn_1 file=assets/win.webm\n```\n```js file=game.js\nplayNewVideo();\n```');
  await run();
  expect(mocks.readRemote).not.toHaveBeenCalled();
  expect(mocks.writeFile).not.toHaveBeenCalled();
  expect(mocks.writeChat.mock.calls.at(-1)?.[1].at(-1).text).toContain('no longer available');
 });
});


describe('stopping a build during file saves',()=>{
 it('finishes the in-flight save, stops remaining writes and reports the saved file',async()=>{
  const controller=new AbortController();
  const changed=vi.fn();
  mocks.stream.mockResolvedValue('```html file=index.html\n<h1>New page</h1>\n```\n```css file=styles.css\nbody{color:red}\n```');
  mocks.writeFile.mockImplementationOnce(async()=>{controller.abort();});
  await runVibeTurn({project:{id:'p',name:'Game'} as ProjectMeta,userText:'Build a new page',connection:{} as ProviderConnection,secret:'test',model:'test',signal:controller.signal,callbacks:{onStream:vi.fn(),onMessages:vi.fn(),onFilesChanged:changed}});
  expect(mocks.writeFile).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledWith(['index.html']);
  expect(mocks.generated).not.toHaveBeenCalled();
  expect(mocks.writeChat.mock.calls.at(-1)?.[1].at(-1)).toMatchObject({error:'aborted',filesWritten:['index.html'],text:expect.stringContaining('Files already saved')});
 });
 it('does not save a completed reply when cancellation wins before its application',async()=>{
  const controller=new AbortController();
  mocks.stream.mockImplementation(async()=>{controller.abort();return '```html file=index.html\n<h1>New page</h1>\n```';});
  await runVibeTurn({project:{id:'p',name:'Game'} as ProjectMeta,userText:'Build a new page',connection:{} as ProviderConnection,secret:'test',model:'test',signal:controller.signal,callbacks:{onStream:vi.fn(),onMessages:vi.fn(),onFilesChanged:vi.fn()}});
  expect(mocks.writeFile).not.toHaveBeenCalled();
  expect(mocks.generated).not.toHaveBeenCalled();
  expect(mocks.writeChat.mock.calls.at(-1)?.[1].at(-1)).toMatchObject({error:'aborted',text:'Stopped.'});
 });
});
it('does not submit media when stop arrives during the last file save',async()=>{
 const controller=new AbortController();
 mocks.stream.mockResolvedValue('```html file=index.html\n<h1>New page</h1>\n```\n```medialab kind=image file=assets/hero.png\nA red square\n```');
 mocks.writeFile.mockImplementationOnce(async()=>{controller.abort();});
 await runVibeTurn({project:{id:'p',name:'Game'} as ProjectMeta,userText:'Build a new page',connection:{} as ProviderConnection,secret:'test',model:'test',signal:controller.signal,callbacks:{onStream:vi.fn(),onMessages:vi.fn(),onFilesChanged:vi.fn()}});
 expect(mocks.writeFile).toHaveBeenCalledTimes(1);
 expect(mocks.generated).not.toHaveBeenCalled();
 expect(mocks.writeChat.mock.calls.at(-1)?.[1].at(-1)).toMatchObject({error:'aborted',filesWritten:['index.html']});
});
