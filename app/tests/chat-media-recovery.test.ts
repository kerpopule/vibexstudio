import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatMessage, ProjectMeta, ProviderConnection } from '@/lib/types';
import { useChat } from '@/lib/chat-engine';
import { retryRequest } from '@/lib/retry-request';
const mocks = vi.hoisted(() => ({
  find:vi.fn(), forget:vi.fn(), providers:[] as ProviderConnection[], binary:vi.fn(), importAsset:vi.fn(), secret: vi.fn(), read: vi.fn(), write: vi.fn(), image: vi.fn(), video: vi.fn(), slot: vi.fn(),
}));
vi.mock('react-native', () => ({AppState:{addEventListener:vi.fn()}}));
vi.mock('expo-haptics', () => ({}));
vi.mock('expo-keep-awake', () => ({}));
vi.mock('@/lib/ai/media', () => ({generateImage:mocks.image,generateVideo:mocks.video}));
vi.mock('@/lib/concurrency', () => ({acquireTurnSlot:mocks.slot,releaseTurnSlot:vi.fn()}));
vi.mock('@/lib/notifications', () => ({primeNotifications:async()=>{},notifyProjectEvent:async()=>{}}));
vi.mock('@/lib/storage/projects', () => ({newId:()=>crypto.randomUUID(),readChat:mocks.read,writeChat:mocks.write,writeBinaryFile:mocks.binary}));
vi.mock('@/lib/storage/import-asset', () => ({importProjectAsset:mocks.importAsset}));
vi.mock('@/lib/ai/fal-recovery',()=>({getFalRequest:mocks.find,forgetFalRequest:mocks.forget}));
vi.mock('@/lib/storage/secrets', () => ({getProviderSecret:mocks.secret}));
vi.mock('@/lib/store', () => ({useApp:{getState:()=>({providers:mocks.providers})}}));
vi.mock('@/lib/vibe', () => ({}));
const project = {id:'project'} as ProjectMeta;
const provider = {id:'media',label:'My media connection'} as ProviderConnection;
let saved: ChatMessage[];
beforeEach(() => {
  vi.clearAllMocks();mocks.find.mockResolvedValue(null);mocks.forget.mockResolvedValue(undefined);mocks.providers=[];mocks.slot.mockResolvedValue(undefined);mocks.binary.mockResolvedValue('file:///fixture/image.png');mocks.importAsset.mockResolvedValue('file:///fixture/video.mp4');
  saved = [{id:'previous',role:'assistant',text:'Existing conversation',createdAt:1}];
  mocks.read.mockImplementation(async()=>structuredClone(saved));
  mocks.write.mockImplementation(async(_id, messages)=>{saved=structuredClone(messages);});
  mocks.secret.mockResolvedValue(null);
  useChat.setState({sessions:{}});
});
it.each(['image','video'] as const)('preserves a %s request when its saved key is missing, including after reload', async kind => {
  await useChat.getState().sendMedia(project,'A little spaceship',kind,provider);
  expect(saved[0].id).toBe('previous');
  expect(saved.at(-1)).toMatchObject({error:'no-secret',text:expect.stringContaining('Reconnect')});
  useChat.setState({sessions:{}});
  await useChat.getState().load(project.id);
  const user = useChat.getState().sessions[project.id].messages.find(m=>m.role==='user')!;
  expect(retryRequest(user)).toEqual({mode:kind,prompt:'A little spaceship'});
  expect(mocks.image).not.toHaveBeenCalled();
  expect(mocks.video).not.toHaveBeenCalled();
  expect(mocks.slot).not.toHaveBeenCalled();
  expect(useChat.getState().sessions[project.id].busy).toBe(false);
});
it('propagates a persistence failure so the composer can restore the unsaved draft', async () => {
  mocks.write.mockRejectedValueOnce(new Error('Storage full'));
  await expect(useChat.getState().sendMedia(project,'Keep this prompt','image',provider)).rejects.toThrow('Storage full');
  expect(saved).toHaveLength(1);
  expect(mocks.image).not.toHaveBeenCalled();
});

it.each(['image','video'] as const)('resumes project %s with the original fal provider, model and request identity',async kind=>{
 const original={id:'original-fal',kind:'fal',label:'Original fal',mediaModels:{[kind]:'fal-ai/new-default'}} as ProviderConnection;
 mocks.providers=[original];mocks.secret.mockResolvedValue('test-key');
 mocks.find.mockResolvedValue({id:'old-request',projectId:project.id,providerId:original.id,providerLabel:original.label,kind,prompt:'Spaceship',model:'fal-ai/original',phase:'accepted'});
 saved.push({id:'old-request',role:'user',text:'Generate',request:{mode:kind,prompt:'Spaceship'},createdAt:2});
 mocks.image.mockResolvedValue({base64:'AQID',mimeType:'image/png'});mocks.video.mockResolvedValue({url:'https://example.test/video.mp4',mimeType:'video/mp4'});
 await useChat.getState().sendMedia(project,'Spaceship',kind,provider,'old-request');
 const call=(kind==='image'?mocks.image:mocks.video).mock.calls[0];
 expect(call[0]).toMatchObject({id:original.id,mediaModels:{[kind]:'fal-ai/original'}});
 expect(call.slice(-2)).toEqual(['old-request',project.id]);
 expect(saved.filter(message=>message.role==='user')).toHaveLength(1);
 expect(saved.at(-1)?.id).toBe('fal-result-old-request');
 expect(mocks.forget).toHaveBeenCalledWith('old-request');
});
it('refuses a request from another project before accessing a provider key',async()=>{
 mocks.find.mockResolvedValue({projectId:'different',prompt:'Spaceship',kind:'image'});
 await expect(useChat.getState().sendMedia(project,'Spaceship','image',provider,'old-request')).rejects.toThrow('another');
 expect(mocks.secret).not.toHaveBeenCalled();
});
it('recognizes a landed chat attachment after restart without regenerating',async()=>{
 const fal={id:'original-fal',kind:'fal',label:'Original'} as ProviderConnection;mocks.providers=[fal];
 mocks.find.mockResolvedValue({id:'old-request',projectId:project.id,providerId:fal.id,kind:'image',prompt:'Spaceship',model:'fal-ai/original',phase:'accepted'});
 saved.push({id:'fal-result-old-request',role:'assistant',text:'Saved image',createdAt:2});
 await useChat.getState().sendMedia(project,'Spaceship','image',provider,'old-request');
 expect(mocks.secret).not.toHaveBeenCalled();expect(mocks.image).not.toHaveBeenCalled();expect(mocks.forget).toHaveBeenCalledWith('old-request');
});

it('reserves the project while a saved request is being read',async()=>{
 let finish:(value:null)=>void=()=>{};
 mocks.find.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const first=useChat.getState().sendMedia(project,'Spaceship','image',provider,'old-request');
 await useChat.getState().sendMedia(project,'Spaceship','image',provider,'old-request');
 expect(mocks.find).toHaveBeenCalledTimes(1);
 finish(null);await first;
 expect(saved.filter(message=>message.role==='user')).toHaveLength(1);
});
