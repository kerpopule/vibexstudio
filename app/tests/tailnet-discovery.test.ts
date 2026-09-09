import { afterEach, expect, it, vi } from 'vitest';
import { discoverTailnetDevices, discoverTailnetMediaServices, localControllerStatus, installLocalController, startLocalController } from '../src/lib/local-controller';
afterEach(() => vi.unstubAllGlobals());
it('requires the desktop bridge without issuing browser network requests', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', undefined);
  await expect(discoverTailnetDevices()).rejects.toThrow('installed desktop app');
});
it('returns private tailnet addresses and discards malformed or public entries', async () => {
  const invoke = vi.fn().mockResolvedValue([
    { name: 'Spark', address: 'YOUR_TAILNET_IP', online: true },
    { name: 'Public', address: '100.200.1.1', online: true },
    { name: 'Bad', address: '100.64.1.999', online: true },
  ]);
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
  expect(await discoverTailnetDevices()).toEqual([{ name: 'Spark', address: 'YOUR_TAILNET_IP', online: true }]);
  expect(invoke).toHaveBeenCalledWith('tailscale_devices');
});

it('separates installation, retry, and activation commands', async () => {
  const invoke = vi.fn().mockResolvedValue('/private/installation');
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
  await installLocalController(false);
  expect(invoke).toHaveBeenLastCalledWith('install_bundled_controller', { resume: false });
  await installLocalController(true);
  expect(invoke).toHaveBeenLastCalledWith('install_bundled_controller', { resume: true });
  expect(invoke).not.toHaveBeenCalledWith('medialab_enable');
  await startLocalController();
  expect(invoke).toHaveBeenLastCalledWith('medialab_enable');
});

it('restores existing setup flags without returning pairing material or starting services', async () => {
  const invoke = vi.fn().mockResolvedValue({configured:true, independent:true, running:false, pairUrl:'private'});
  vi.stubGlobal('__TAURI_INTERNALS__', {invoke});
  expect(await localControllerStatus()).toEqual({configured:true, independent:true, running:false});
  expect(invoke.mock.calls).toEqual([['medialab_status']]);
  invoke.mockResolvedValue({running:true});
  await expect(localControllerStatus()).rejects.toThrow('Could not read local setup');
});

it('reports installation limitations without exposing unrelated desktop state', async () => {
  const invoke=vi.fn().mockResolvedValue({configured:false,independent:false,running:false,installationAvailable:false,installationMessage:'Connect your own server.',pairUrl:'private',python:'/private/path'});
  vi.stubGlobal('__TAURI_INTERNALS__',{invoke});
  expect(await localControllerStatus()).toEqual({configured:false,independent:false,running:false,installationAvailable:false,installationMessage:'Connect your own server.'});
  expect(invoke.mock.calls).toEqual([['medialab_status']]);
});

it('checks only the selected peer and returns explicit origins instead of a guessed port',async()=>{
 const invoke=vi.fn().mockResolvedValue(['https://spark.example.ts.net:8450','http://YOUR_TAILNET_IP:7864']);
 vi.stubGlobal('__TAURI_INTERNALS__',{invoke});
 expect(await discoverTailnetMediaServices('YOUR_TAILNET_IP')).toEqual(['https://spark.example.ts.net:8450','http://YOUR_TAILNET_IP:7864']);
 expect(invoke).toHaveBeenCalledWith('tailscale_media_services',{address:'YOUR_TAILNET_IP'});
 invoke.mockResolvedValue([]);expect(await discoverTailnetMediaServices('YOUR_TAILNET_IP')).toEqual([]);
 for(const url of ['https://user:secret@host','https://host/path','https://host?key=secret','file:///tmp/file']){
  invoke.mockResolvedValue([url]);await expect(discoverTailnetMediaServices('YOUR_TAILNET_IP')).rejects.toThrow();
 }
});
