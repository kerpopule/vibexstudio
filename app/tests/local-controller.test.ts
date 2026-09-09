import {afterEach,describe,it,expect,vi} from 'vitest';
import {canUseLocalController,localControllerConnection} from '../src/lib/local-controller';
afterEach(()=>vi.unstubAllGlobals());
describe('local desktop pairing material',()=>{
 it('is unavailable outside the native desktop',async()=>{
  vi.stubGlobal('__TAURI_INTERNALS__',undefined);
  expect(canUseLocalController()).toBe(false);
  await expect(localControllerConnection()).rejects.toThrow('desktop app');
 });
 it('reads only the native connection command',async()=>{
  const invoke=vi.fn().mockResolvedValue({url:'http://127.0.0.1:7864',code:'a'.repeat(64)});
  vi.stubGlobal('__TAURI_INTERNALS__',{invoke});
  expect(await localControllerConnection()).toEqual({url:'http://127.0.0.1:7864',code:'a'.repeat(64)});
  expect(invoke).toHaveBeenCalledExactlyOnceWith('medialab_local_connection');
 });
 it.each(['https://other.example','http://127.0.0.1:0','http://127.0.0.1:65536','http://127.0.0.1:7864/path'])('refuses invalid local address %s',async url=>{
  vi.stubGlobal('__TAURI_INTERNALS__',{invoke:async()=>({url,code:'a'.repeat(64)})});
  await expect(localControllerConnection()).rejects.toThrow('invalid local connection');
 });
 it('refuses malformed access codes',async()=>{
  vi.stubGlobal('__TAURI_INTERNALS__',{invoke:async()=>({url:'http://127.0.0.1:7864',code:'not-a-code'})});
  await expect(localControllerConnection()).rejects.toThrow('invalid local connection');
 });
});
