import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getItem:vi.fn(),setItem:vi.fn(),removeItem:vi.fn(),folderCommand:vi.fn(),syncDesktopFolder:vi.fn(),desktopFolderBusy:vi.fn(()=>false),desktopFolderAvailable:vi.fn(()=>true)}));
vi.mock('@react-native-async-storage/async-storage',()=>({default:mocks}));
vi.mock('@/lib/sync/desktop-folder',()=>mocks);
import {startPollingSync,initDesktopFolderSync,setAutoFolder} from '../src/lib/sync/auto-folder';
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();mocks.desktopFolderBusy.mockReturnValue(false);});
afterEach(()=>vi.useRealTimers());
it('waits for a running operation before scheduling another and stops after cleanup',async()=>{
 let finish!:()=>void;const run=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const stop=startPollingSync(run,30);await vi.advanceTimersByTimeAsync(0);
 await vi.advanceTimersByTimeAsync(300);expect(run).toHaveBeenCalledTimes(1);
 stop();finish();await vi.advanceTimersByTimeAsync(300);expect(run).toHaveBeenCalledTimes(1);
});
it('does not sync without opt-in or when a different folder is selected',async()=>{
 mocks.getItem.mockResolvedValueOnce(null).mockResolvedValue('/chosen');mocks.folderCommand.mockResolvedValue({path:'/other'});
 const stop=initDesktopFolderSync();await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(30_000);stop();
 expect(mocks.syncDesktopFolder).not.toHaveBeenCalled();
});
it('binds automatic operations to the opted-in folder and retries errors',async()=>{
 mocks.getItem.mockResolvedValue('/chosen');mocks.folderCommand.mockResolvedValue({path:'/chosen'});
 mocks.syncDesktopFolder.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({pushed:1,pulled:0,busy:0,conflicts:[],failures:[]});
 const stop=initDesktopFolderSync();await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(30_000);stop();
 expect(mocks.syncDesktopFolder).toHaveBeenCalledTimes(2);expect(mocks.syncDesktopFolder).toHaveBeenLastCalledWith('/chosen');
});
it('skips a manual operation already running and clears opt-in when disabled',async()=>{
 mocks.getItem.mockResolvedValue('/chosen');mocks.desktopFolderBusy.mockReturnValue(true);
 const stop=initDesktopFolderSync();await vi.advanceTimersByTimeAsync(0);stop();expect(mocks.syncDesktopFolder).not.toHaveBeenCalled();
 await setAutoFolder('/chosen',false);expect(mocks.removeItem).toHaveBeenCalled();
});
