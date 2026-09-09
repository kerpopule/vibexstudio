import {beforeEach, expect, it, vi} from 'vitest';
import type {ProviderConnection} from '@/lib/types';
import {useMediaStudio} from '@/lib/media-studio';

const mocked = vi.hoisted(() => ({
  findRecovery:vi.fn(), recover:vi.fn(), forget:vi.fn(), notify: vi.fn(), secret: vi.fn(), acquire: vi.fn(), release: vi.fn(), image: vi.fn(), save: vi.fn(),
  delete: vi.fn(), list: vi.fn(), awake: vi.fn(), sleep: vi.fn(), providers: [] as ProviderConnection[],
}));
vi.mock('expo-keep-awake', () => ({activateKeepAwakeAsync: mocked.awake, deactivateKeepAwake: mocked.sleep}));
vi.mock('@/lib/ai/media', () => ({canGenerateImages: () => true, canGenerateVideo: () => true,
  generateImage: mocked.image, generateVideo: vi.fn()}));
vi.mock('@/lib/concurrency', () => ({acquireTurnSlot: mocked.acquire, releaseTurnSlot: mocked.release}));
vi.mock('@/lib/notifications', () => ({notifyEvent: mocked.notify, primeNotifications: async () => {}}));
vi.mock('@/lib/storage/media-gallery', () => ({deleteGalleryItem: mocked.delete, listGallery: mocked.list,
  saveGalleryImage: mocked.save, saveGalleryVideo: vi.fn()}));
vi.mock('@/lib/storage/projects', () => ({newId: () => 'recovery-job'}));
vi.mock('@/lib/storage/secrets', () => ({getProviderSecret: mocked.secret}));
vi.mock('@/lib/store', () => ({useApp: {getState: () => ({providers: mocked.providers})}}));

vi.mock('@/lib/ai/fal-recovery',()=>({getFalRequest:mocked.findRecovery,listFalRequests:mocked.recover,forgetFalRequest:mocked.forget}));

const provider = {id:'test-provider',label:'Test creator',kind:'openai'} as ProviderConnection;
beforeEach(() => {
  vi.resetAllMocks();
  mocked.findRecovery.mockResolvedValue(null);mocked.recover.mockResolvedValue([]);mocked.forget.mockResolvedValue(undefined);
  mocked.providers = [provider];
  mocked.notify.mockResolvedValue(undefined);
  mocked.list.mockResolvedValue([]);
  mocked.secret.mockResolvedValue('test-only-secret');
  mocked.acquire.mockResolvedValue(undefined);
  mocked.awake.mockResolvedValue(undefined);
  mocked.sleep.mockResolvedValue(undefined);
  mocked.image.mockResolvedValue({base64:'fixture',mimeType:'image/png'});
  mocked.save.mockResolvedValue({id:'saved-image',prompt:'A game background',kind:'image'});
  useMediaStudio.setState({jobs:[],items:[],hydrated:false});
});

it('preserves a retryable job when the keychain throws, then creates exactly once after recovery', async () => {
  mocked.secret.mockRejectedValueOnce(new Error('private platform error'));
  expect(await useMediaStudio.getState().generate('image','A game background',provider)).toBe(false);
  expect(useMediaStudio.getState().jobs).toEqual([expect.objectContaining({
    id:'recovery-job',prompt:'A game background',status:'error',error:expect.stringContaining('Unlock your device'),
  })]);
  expect(mocked.acquire).not.toHaveBeenCalled();
  expect(mocked.release).not.toHaveBeenCalled();
  expect(mocked.image).not.toHaveBeenCalled();
  useMediaStudio.getState().retryJob('recovery-job');
  useMediaStudio.getState().retryJob('recovery-job');
  await vi.waitFor(() => expect(useMediaStudio.getState().items).toHaveLength(1));
  expect(useMediaStudio.getState().jobs).toEqual([]);
  expect(mocked.image).toHaveBeenCalledExactlyOnceWith(provider,'test-only-secret','A game background');
  expect(mocked.release).toHaveBeenCalledTimes(1);
});

it('retains the original prompt on queue rejection and never releases an unacquired slot', async () => {
  mocked.acquire.mockRejectedValueOnce(new Error('queue unavailable'));
  expect(await useMediaStudio.getState().generate('image','A game background',provider)).toBe(false);
  expect(useMediaStudio.getState().jobs[0]).toMatchObject({prompt:'A game background',status:'error'});
  expect(mocked.release).not.toHaveBeenCalled();
  expect(mocked.image).not.toHaveBeenCalled();
  expect(mocked.awake).not.toHaveBeenCalled();
});

it('keeps a failed render retryable and releases its acquired slot and wake lock', async () => {
  mocked.image.mockRejectedValueOnce(new Error('Test render failed'));
  expect(await useMediaStudio.getState().generate('image','A game background',provider)).toBe(false);
  expect(useMediaStudio.getState().jobs[0]).toMatchObject({prompt:'A game background',status:'error',error:'Test render failed'});
  expect(mocked.release).toHaveBeenCalledTimes(1);
  expect(mocked.sleep).toHaveBeenCalledTimes(1);
  expect(mocked.save).not.toHaveBeenCalled();
});


it('preserves a newly generated item when a slower Library load finishes', async () => {
  let finish!: (items: unknown[]) => void;
  mocked.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const loading = useMediaStudio.getState().hydrate();
  const second = useMediaStudio.getState().hydrate();
  expect(await useMediaStudio.getState().generate('image', 'A game background', provider)).toBe(true);
  finish([{id:'older-image',createdAt:1}, {id:'saved-image',createdAt:2}]);
  await Promise.all([loading, second]);
  expect(mocked.list).toHaveBeenCalledTimes(1);
  expect(useMediaStudio.getState().items.map((item) => item.id).sort()).toEqual(['older-image','saved-image']);
  expect(useMediaStudio.getState().items.find((item) => item.id === 'saved-image')?.prompt).toBe('A game background');
});

it('retries a failed Library load on the next visit', async () => {
  mocked.list.mockRejectedValueOnce(new Error('temporary storage failure'));
  await useMediaStudio.getState().hydrate();
  expect(useMediaStudio.getState().hydrated).toBe(false);
  mocked.list.mockResolvedValueOnce([{id:'restored-image',createdAt:1}]);
  await useMediaStudio.getState().hydrate();
  expect(useMediaStudio.getState().hydrated).toBe(true);
  expect(useMediaStudio.getState().items[0].id).toBe('restored-image');
});

it('suppresses duplicate submissions while credentials are still loading',async()=>{
 let resolve!:(secret:string)=>void;
 mocked.secret.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const first=useMediaStudio.getState().generate('image','A game background',provider);
 expect(await useMediaStudio.getState().generate('image','  A game background  ',provider)).toBe(false);
 expect(useMediaStudio.getState().jobs).toHaveLength(1);
 expect(mocked.secret).toHaveBeenCalledTimes(1);
 resolve('test-only-secret');expect(await first).toBe(true);
 expect(mocked.image).toHaveBeenCalledTimes(1);
});

it('matches active requests by kind, prompt and provider without blocking failed requests',async()=>{
 const {hasActiveCreation}=await import('@/lib/media-studio');
 const job={id:'x',kind:'image' as const,prompt:'Sprite',providerId:'a',providerLabel:'A',status:'running' as const,detail:''};
 expect(hasActiveCreation([job],'image',' Sprite ','a')).toBe(true);
 expect(hasActiveCreation([job],'image','Different','a')).toBe(false);
 expect(hasActiveCreation([job],'image','Sprite','b')).toBe(false);
 expect(hasActiveCreation([job],'video','Sprite','a')).toBe(false);
 expect(hasActiveCreation([{...job,status:'error'}],'image','Sprite','a')).toBe(false);
});

it('keeps a gallery item visible when deletion fails and removes it only after success',async()=>{
 const item={id:'keep',prompt:'Keep visible',kind:'image'} as import('@/lib/types').GalleryItem;
 useMediaStudio.setState({items:[item]});mocked.delete.mockRejectedValueOnce(Error('Storage unavailable'));
 await expect(useMediaStudio.getState().removeItem('keep')).rejects.toThrow('Storage unavailable');
 expect(useMediaStudio.getState().items).toEqual([item]);
 mocked.delete.mockResolvedValueOnce(undefined);await useMediaStudio.getState().removeItem('keep');
 expect(useMediaStudio.getState().items).toEqual([]);
});

it('retries only saving after a completed generation, even if its provider was removed',async()=>{
 mocked.save.mockRejectedValueOnce(Error('Disk full'));
 expect(await useMediaStudio.getState().generate('image','A game background',provider)).toBe(false);
 expect(useMediaStudio.getState().jobs[0].error).toContain('without generating again');
 mocked.providers=[];useMediaStudio.getState().retryJob('recovery-job');useMediaStudio.getState().retryJob('recovery-job');
 await vi.waitFor(()=>expect(useMediaStudio.getState().items).toHaveLength(1));
 expect(mocked.image).toHaveBeenCalledTimes(1);expect(mocked.save).toHaveBeenCalledTimes(2);
 expect(mocked.secret).toHaveBeenCalledTimes(1);expect(mocked.acquire).toHaveBeenCalledTimes(1);
 expect(useMediaStudio.getState().jobs).toEqual([]);
});

it.each(['unchanged', 'prompt', 'provider'])('finishes the submitted draft after save recovery while preserving newer edits (%s)',async(edit)=>{
 const {useCreationDraft}=await import('@/lib/creation-draft');
 useCreationDraft.setState({drafts:{image:{prompt:'  A game background  ',providerId:null},video:{prompt:'Video draft',providerId:null}}});
 mocked.save.mockRejectedValueOnce(Error('Disk full'));
 expect(await useMediaStudio.getState().generate('image','  A game background  ',provider,null)).toBe(false);
 expect(useCreationDraft.getState().drafts.image.prompt).toBe('  A game background  ');
 if(edit==='prompt')useCreationDraft.getState().setPrompt('image','Next creation');
 if(edit==='provider')useCreationDraft.getState().setProvider('image','another-provider');
 useMediaStudio.getState().retryJob('recovery-job');
 await vi.waitFor(()=>expect(useMediaStudio.getState().jobs).toHaveLength(0));
 expect(useCreationDraft.getState().drafts.image.prompt).toBe(edit==='prompt'?'Next creation':edit==='provider'?'  A game background  ':'');
 expect(useCreationDraft.getState().drafts.video.prompt).toBe('Video draft');
 expect(mocked.image).toHaveBeenCalledTimes(1);
});

it('clears the original draft after a render retry succeeds',async()=>{
 const {useCreationDraft}=await import('@/lib/creation-draft');
 useCreationDraft.setState({drafts:{image:{prompt:'Sprite',providerId:provider.id},video:{prompt:'',providerId:null}}});
 mocked.image.mockRejectedValueOnce(Error('Renderer unavailable'));
 expect(await useMediaStudio.getState().generate('image','Sprite',provider,provider.id)).toBe(false);
 expect(useCreationDraft.getState().drafts.image.prompt).toBe('Sprite');
 useMediaStudio.getState().retryJob('recovery-job');
 await vi.waitFor(()=>expect(useMediaStudio.getState().jobs).toHaveLength(0));
 expect(useCreationDraft.getState().drafts.image.prompt).toBe('');
 expect(mocked.image).toHaveBeenCalledTimes(2);
});

it('distinguishes save recovery from generation failure and notifies completion once',async()=>{
 mocked.save.mockRejectedValueOnce(Error('Disk full'));
 await useMediaStudio.getState().generate('image','Sprite',provider);
 expect(useMediaStudio.getState().jobs[0].retryAction).toBe('save');
 expect(mocked.notify).toHaveBeenCalledExactlyOnceWith('🎬 Media Lab needs a save',expect.stringContaining('Retry save'));
 useMediaStudio.getState().retryJob('recovery-job');
 useMediaStudio.getState().retryJob('recovery-job');
 await vi.waitFor(()=>expect(useMediaStudio.getState().jobs).toHaveLength(0));
 expect(mocked.notify).toHaveBeenCalledTimes(2);
 expect(mocked.notify).toHaveBeenLastCalledWith('🎬 Media Lab','Your image is ready in Library.');
 expect(mocked.image).toHaveBeenCalledTimes(1);
});

it('emits a single completion notice on the first successful save',async()=>{
 expect(await useMediaStudio.getState().generate('image','Sprite',provider)).toBe(true);
 expect(mocked.notify).toHaveBeenCalledExactlyOnceWith('🎬 Media Lab','Your image is ready in Library.');
});

it('ignores stale dismissal while a recovered result is saving',async()=>{
 mocked.save.mockRejectedValueOnce(Error('Disk full'));
 await useMediaStudio.getState().generate('image','Sprite',provider);
 let finish!:(item:unknown)=>void;
 mocked.save.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 useMediaStudio.getState().retryJob('recovery-job');
 useMediaStudio.getState().dismissJob('recovery-job');
 expect(useMediaStudio.getState().jobs[0].status).toBe('running');
 finish({id:'saved-image',kind:'image',prompt:'Sprite'});
 await vi.waitFor(()=>expect(useMediaStudio.getState().jobs).toHaveLength(0));
 expect(useMediaStudio.getState().items).toHaveLength(1);
 expect(mocked.image).toHaveBeenCalledTimes(1);
});

it('discards an explicitly dismissed failed save without another generation',async()=>{
 mocked.save.mockRejectedValueOnce(Error('Disk full'));
 await useMediaStudio.getState().generate('image','Sprite',provider);
 useMediaStudio.getState().dismissJob('recovery-job');
 useMediaStudio.getState().retryJob('recovery-job');
 expect(useMediaStudio.getState().jobs).toEqual([]);
 expect(useMediaStudio.getState().items).toEqual([]);
 expect(mocked.image).toHaveBeenCalledTimes(1);
 expect(mocked.save).toHaveBeenCalledTimes(1);
});


it('restores a fal job using its original model and stable gallery identity',async()=>{
 const fal={...provider,kind:'fal' as const,mediaModels:{image:'fal-ai/new-default'}};
 mocked.providers=[fal];
 mocked.recover.mockResolvedValue([{id:'saved-fal',providerId:fal.id,providerLabel:fal.label,kind:'image',prompt:'Original prompt',model:'fal-ai/original',phase:'accepted'}]);
 await useMediaStudio.getState().hydrate();
 expect(useMediaStudio.getState().jobs[0]).toMatchObject({id:'saved-fal',status:'error',falModel:'fal-ai/original'});
 useMediaStudio.getState().retryJob('saved-fal');
 await vi.waitFor(()=>expect(useMediaStudio.getState().jobs).toHaveLength(0));
 expect(mocked.image).toHaveBeenCalledWith(expect.objectContaining({mediaModels:{image:'fal-ai/original'}}),'test-only-secret','Original prompt','saved-fal');
 expect(mocked.save).toHaveBeenCalledWith('Original prompt',fal.label,'fixture','image/png','saved-fal');
 expect(mocked.forget).toHaveBeenCalledWith('saved-fal');
});
it('does not recover a job whose stable gallery entry already landed before restart',async()=>{
 mocked.list.mockResolvedValue([{id:'fal-saved-fal',createdAt:1}]);
 mocked.recover.mockResolvedValue([{id:'saved-fal',providerId:provider.id,providerLabel:'fal',kind:'image',prompt:'Original',model:'fal-ai/original',phase:'accepted'}]);
 await useMediaStudio.getState().hydrate();
 expect(useMediaStudio.getState().jobs).toEqual([]);expect(mocked.image).not.toHaveBeenCalled();
 expect(mocked.forget).toHaveBeenCalledWith('saved-fal');
});

it('does not retry an uncertain recovered fal submission',async()=>{
 mocked.recover.mockResolvedValue([{id:'uncertain',providerId:provider.id,providerLabel:'fal',kind:'image',prompt:'Original',model:'fal-ai/original',phase:'submitting'}]);
 await useMediaStudio.getState().hydrate();
 expect(useMediaStudio.getState().jobs[0].retryAction).toBe('review');
 useMediaStudio.getState().retryJob('uncertain');
 expect(mocked.secret).not.toHaveBeenCalled();expect(mocked.image).not.toHaveBeenCalled();
});
it.each(['accepted','submitting'])('chooses the appropriate recovery action after a fal error (%s)',async phase=>{
 const fal={...provider,kind:'fal' as const};mocked.providers=[fal];
 mocked.image.mockRejectedValueOnce(new Error('Connection lost'));
 mocked.findRecovery.mockResolvedValue({phase});
 await useMediaStudio.getState().generate('image','Original',fal);
 expect(useMediaStudio.getState().jobs[0].retryAction).toBe(phase==='accepted'?'resume':'review');
});

it('leaves project-owned fal recovery in the project instead of the Create queue',async()=>{
 mocked.recover.mockResolvedValue([{id:'project-request',projectId:'p1',providerId:provider.id,providerLabel:'fal',kind:'image',prompt:'Project image',model:'fal-ai/original',phase:'accepted'}]);
 await useMediaStudio.getState().hydrate();
 expect(useMediaStudio.getState().jobs).toEqual([]);expect(mocked.forget).not.toHaveBeenCalled();
});

it.each(['image','video'] as const)('checks saved %s requests before a fresh fal generation',async kind=>{
 const fal={...provider,kind:'fal' as const};mocked.providers=[fal];
 mocked.recover.mockResolvedValue([{id:'old-fal',providerId:fal.id,providerLabel:'fal',kind,prompt:'Original',model:'fal-ai/original',phase:'accepted'}]);
 await expect(useMediaStudio.getState().generate(kind,' Original ',fal)).rejects.toThrow('saved request below');
 expect(mocked.secret).not.toHaveBeenCalled();expect(mocked.acquire).not.toHaveBeenCalled();
 expect(useMediaStudio.getState().jobs[0]).toMatchObject({id:'old-fal',retryAction:'resume'});
});
it('stops fal submission when recovery storage fails and permits retry after recovery',async()=>{
 const fal={...provider,kind:'fal' as const};mocked.providers=[fal];
 mocked.recover.mockRejectedValueOnce(Error('storage unavailable'));
 await expect(useMediaStudio.getState().generate('image','Original',fal)).rejects.toThrow('could not be checked');
 expect(mocked.secret).not.toHaveBeenCalled();
 await useMediaStudio.getState().generate('image','Original',fal);
 expect(mocked.image).toHaveBeenCalledTimes(1);
});
it('reserves the same fal prompt while cold-start hydration is pending',async()=>{
 const fal={...provider,kind:'fal' as const};mocked.providers=[fal];
 let finish!:(items:unknown[])=>void;
 mocked.list.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const first=useMediaStudio.getState().generate('image','Original',fal);
 expect(await useMediaStudio.getState().generate('image',' Original ',fal)).toBe(false);
 expect(mocked.secret).not.toHaveBeenCalled();
 finish([]);await first;expect(mocked.image).toHaveBeenCalledTimes(1);
});
