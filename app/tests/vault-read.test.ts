import {afterEach,it,expect,vi} from 'vitest';
import {invalidateVaultRead,readVaultSecret} from '../src/lib/vault-read';
afterEach(()=>vi.useRealTimers());
it('reports a bounded wait and shares the still-running native read on retry',async()=>{
 vi.useFakeTimers();let finish!:(value:unknown)=>void;
 const invoke=vi.fn(()=>new Promise<unknown>(resolve=>{finish=resolve;}));
 const first=readVaultSecret(invoke,'timeout-test');
 const error=expect(first).rejects.toThrow('credential vault is taking too long');
 await vi.advanceTimersByTimeAsync(10_000);await error;
 const retry=readVaultSecret(invoke,'timeout-test');
 expect(invoke).toHaveBeenCalledTimes(1);
 finish('private-test-value');expect(await retry).toBe('private-test-value');
});
it('propagates denial and allows a later independent retry',async()=>{
 const invoke=vi.fn().mockRejectedValueOnce(Error('Vault denied')).mockResolvedValueOnce(null);
 await expect(readVaultSecret(invoke,'denied-test')).rejects.toThrow('Vault denied');
 expect(await readVaultSecret(invoke,'denied-test')).toBeNull();
 expect(invoke).toHaveBeenCalledTimes(2);
});

it('does not reuse an old pending read after a successful credential mutation',async()=>{
 let finish!:(value:unknown)=>void;
 const invoke=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce('new-value');
 const old=readVaultSecret(invoke,'changed-test');await Promise.resolve();
 invalidateVaultRead('changed-test');
 expect(await readVaultSecret(invoke,'changed-test')).toBe('new-value');
 finish('old-value');expect(await old).toBe('old-value');
 expect(invoke).toHaveBeenCalledTimes(2);
});
