import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getItem:vi.fn(),setItem:vi.fn(),removeItem:vi.fn(),pairedSyncConnection:vi.fn(),pairedServerBusy:vi.fn(),syncPairedServer:vi.fn()}));
vi.mock('@react-native-async-storage/async-storage',()=>({default:mocks}));
vi.mock('@/lib/sync/paired-server',()=>mocks);
import {initPairedServerSync,setAutoServer,getAutoServerStatus} from '../src/lib/sync/auto-server';
const result={pushed:1,pulled:0,unchanged:0,busy:0,conflicts:[],failures:[]};
beforeEach(()=>{vi.useFakeTimers();vi.resetAllMocks();mocks.getItem.mockResolvedValue('identity1');mocks.pairedSyncConnection.mockResolvedValue({url:'https://mine.test',identity:'identity1'});mocks.syncPairedServer.mockResolvedValue(result);});
afterEach(()=>vi.useRealTimers());
it('does not sync without opt-in, in background, or during manual sync',async()=>{
 let active=false;const stop=initPairedServerSync(()=>active,10);
 await vi.advanceTimersByTimeAsync(0);active=true;mocks.getItem.mockResolvedValue(null);
 await vi.advanceTimersByTimeAsync(10);mocks.getItem.mockResolvedValue('identity1');mocks.pairedServerBusy.mockReturnValue(true);
 await vi.advanceTimersByTimeAsync(10);stop();expect(mocks.syncPairedServer).not.toHaveBeenCalled();
});
it('does not transfer opt-in to a changed server or rotated token',async()=>{
 mocks.pairedSyncConnection.mockResolvedValue({url:'https://mine.test',identity:'identity2'});
 const stop=initPairedServerSync(()=>true);await vi.advanceTimersByTimeAsync(0);stop();
 expect(mocks.syncPairedServer).not.toHaveBeenCalled();expect(getAutoServerStatus().message).toContain('paused');
 await expect(setAutoServer('identity1',true)).rejects.toThrow('changed');expect(mocks.setItem).not.toHaveBeenCalled();
});
it('serializes transfers and stops scheduling when disposed',async()=>{
 let finish!:(value:typeof result)=>void;mocks.syncPairedServer.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const stop=initPairedServerSync(()=>true,10);await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(100);
 expect(mocks.syncPairedServer).toHaveBeenCalledExactlyOnceWith('https://mine.test','identity1');
 stop();finish(result);await vi.advanceTimersByTimeAsync(100);expect(mocks.syncPairedServer).toHaveBeenCalledTimes(1);
});
it('retries offline failures and exposes preserved conflicts for the UI',async()=>{
 mocks.syncPairedServer.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({...result,conflicts:['p1']});
 const stop=initPairedServerSync(()=>true,10);await vi.advanceTimersByTimeAsync(0);expect(getAutoServerStatus().message).toContain('Offline');
 await vi.advanceTimersByTimeAsync(10);stop();expect(getAutoServerStatus().result?.conflicts).toEqual(['p1']);
});
it('rechecks opt-in after awaiting a connection and stores no raw credentials',async()=>{
 mocks.getItem.mockResolvedValueOnce('identity1').mockResolvedValue(null);
 const stop=initPairedServerSync(()=>true);await vi.advanceTimersByTimeAsync(0);stop();expect(mocks.syncPairedServer).not.toHaveBeenCalled();
 await setAutoServer('identity1',true);expect(mocks.setItem).toHaveBeenCalledWith('vibex.server-sync.auto.v1','identity1');
 await setAutoServer('identity1',false);expect(mocks.removeItem).toHaveBeenCalledWith('vibex.server-sync.auto.v1');
});
