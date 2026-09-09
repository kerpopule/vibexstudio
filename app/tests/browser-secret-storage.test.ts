import {createHash} from 'node:crypto';
import {afterEach, expect, it, vi} from 'vitest';
vi.mock('expo-crypto', () => ({CryptoDigestAlgorithm:{SHA256:'SHA-256'},digestStringAsync:async(_:string,value:string)=>createHash('sha256').update(value).digest('hex')}));
import {getEditingConnection,setEditingConnection,clearProviderSecret, getProviderSecret, setProviderSecret} from '../src/lib/storage/secrets.web';

afterEach(() => vi.unstubAllGlobals());

it('fails instead of reporting a saved or removed key when browser storage is absent', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', undefined);
  vi.stubGlobal('localStorage', undefined);
  await expect(setProviderSecret('test', 'disposable-key')).rejects.toThrow('storage is unavailable');
  await expect(getProviderSecret('test')).rejects.toThrow('storage is unavailable');
  await expect(clearProviderSecret('test')).rejects.toThrow('storage is unavailable');
});

it('preserves browser storage denial and quota failures', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', undefined);
  const fail = () => { throw new Error('Storage denied'); };
  vi.stubGlobal('localStorage', {setItem: fail, getItem: fail, removeItem: fail});
  await expect(setProviderSecret('test', 'disposable-key')).rejects.toThrow('Storage denied');
  await expect(getProviderSecret('test')).rejects.toThrow('Storage denied');
  await expect(clearProviderSecret('test')).rejects.toThrow('Storage denied');
});

it('round-trips and removes a device-local browser key', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', undefined);
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    setItem: (key:string, value:string) => values.set(key,value),
    getItem: (key:string) => values.get(key) ?? null,
    removeItem: (key:string) => values.delete(key),
  });
  await setProviderSecret('test', 'disposable-key');
  expect(await getProviderSecret('test')).toBe('disposable-key');
  await clearProviderSecret('test');
  expect(await getProviderSecret('test')).toBeNull();
});

it('never falls back to browser storage when the desktop vault refuses a write', async () => {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', {setItem});
  vi.stubGlobal('__TAURI_INTERNALS__', {invoke: vi.fn().mockRejectedValue(Error('Vault denied'))});
  await expect(setProviderSecret('test', 'disposable-key')).rejects.toThrow('Vault denied');
  expect(setItem).not.toHaveBeenCalled();
});

it('keeps editor credentials scoped to the server in the web implementation',async()=>{
 vi.stubGlobal('__TAURI_INTERNALS__',undefined);
 const values=new Map<string,string>();
 vi.stubGlobal('localStorage',{setItem:(key:string,value:string)=>values.set(key,value),getItem:(key:string)=>values.get(key)??null});
 const stored=JSON.stringify({deviceId:'a'.repeat(32),token:'fixture'});
 await setEditingConnection('https://one.example',stored);
 expect(await getEditingConnection('https://one.example')).toBe(stored);
 expect(await getEditingConnection('https://two.example')).toBeNull();
});
