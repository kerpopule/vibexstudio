import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {encodeProjectSnapshot} from '../src/lib/sync/project-snapshot';
const mocks=vi.hoisted(()=>({sync:vi.fn(),replace:vi.fn(),refresh:vi.fn(),reload:vi.fn(),bump:vi.fn(),invoke:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage',()=>({default:{getItem:vi.fn(),setItem:vi.fn()}}));
vi.mock('expo-crypto',()=>({digestStringAsync:vi.fn(),CryptoDigestAlgorithm:{SHA256:'sha256'}}));
vi.mock('@/lib/sync/folder-engine',()=>({syncProjectFolder:mocks.sync,keepBothFolderVersions:vi.fn()}));
vi.mock('@/lib/storage/projects.web',()=>({replaceSyncedProject:mocks.replace}));
vi.mock('@/lib/chat-engine',()=>({useChat:{getState:()=>({sessions:{},reload:mocks.reload,bumpFiles:mocks.bump})}}));
vi.mock('@/lib/store',()=>({useApp:{getState:()=>({refreshProjects:mocks.refresh})}}));
import {syncDesktopFolder,desktopFolderBusy} from '../src/lib/sync/desktop-folder';
const raw=encodeProjectSnapshot({meta:{id:'received',name:'Test',description:'',emoji:'✨',createdAt:1,updatedAt:1},chat:[],files:[]});
beforeEach(()=>{vi.clearAllMocks();mocks.invoke.mockResolvedValue({path:'/chosen'});vi.stubGlobal('__TAURI_INTERNALS__',{invoke:mocks.invoke});});
afterEach(()=>vi.unstubAllGlobals());
it('leaves previews and chat alone when a sync only checks or uploads',async()=>{
 mocks.sync.mockResolvedValue({pushed:1,pulled:0});await syncDesktopFolder();
 expect(mocks.refresh).not.toHaveBeenCalled();expect(mocks.bump).not.toHaveBeenCalled();expect(mocks.reload).not.toHaveBeenCalled();
});
it('reloads only received projects even when a later sync step fails',async()=>{
 mocks.sync.mockImplementation(async adapter=>{await adapter.replace(raw,null);throw new Error('Folder unavailable');});
 await expect(syncDesktopFolder()).rejects.toThrow('Folder unavailable');
 expect(mocks.refresh).toHaveBeenCalledTimes(1);expect(mocks.reload).toHaveBeenCalledExactlyOnceWith('received');expect(mocks.bump).toHaveBeenCalledExactlyOnceWith('received');expect(desktopFolderBusy()).toBe(false);
});
it('does not invalidate a project after its replacement fails',async()=>{
 mocks.replace.mockRejectedValueOnce(new Error('Disk full'));mocks.sync.mockImplementation(async adapter=>adapter.replace(raw,null));
 await expect(syncDesktopFolder()).rejects.toThrow('Disk full');expect(mocks.bump).not.toHaveBeenCalled();expect(desktopFolderBusy()).toBe(false);
});
it('rejects a folder selection change before starting the engine',async()=>{
 await expect(syncDesktopFolder('/previous')).rejects.toThrow('selected folder changed');expect(mocks.sync).not.toHaveBeenCalled();
});
