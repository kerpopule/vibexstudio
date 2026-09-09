import {afterEach,it,expect,vi} from 'vitest';
import {nativeFileExportSink} from '../src/lib/native-file-export';
afterEach(()=>vi.unstubAllGlobals());
it('chunks native writes in order and finishes without browser downloading',async()=>{
 const invoke=vi.fn(async(name:string)=>name==='file_export_begin'?'a'.repeat(32):null);vi.stubGlobal('__TAURI_INTERNALS__',{invoke});
 const sink=(await nativeFileExportSink('test.vibexdir'))!;
 await sink.write(new Uint8Array(300000));await sink.finish();await sink.abort();
 const writes=invoke.mock.calls.filter(c=>c[0]==='file_export_write') as unknown as [string,{sequence:number;bytes:number[]}][];
 expect(writes.map(c=>c[1].sequence)).toEqual([0,1]);expect(writes.map(c=>c[1].bytes.length)).toEqual([262144,37856]);
 expect(invoke.mock.calls.some(c=>c[0]==='file_export_finish')).toBe(true);expect(invoke.mock.calls.some(c=>c[0]==='file_export_abort')).toBe(false);
});
it('does not fall back after cancellation or a native error',async()=>{
 const invoke=vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('disk unavailable'));vi.stubGlobal('__TAURI_INTERNALS__',{invoke});
 await expect(nativeFileExportSink('test.mp4')).rejects.toMatchObject({name:'AbortError'});
 await expect(nativeFileExportSink('test.mp4')).rejects.toThrow('disk unavailable');
});
