import {afterEach,expect,it,vi} from 'vitest';
import {editingExportSink} from '@/lib/editing-export-sink.web';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('keeps the chosen file uncommitted until finish and can abort it',async()=>{
 const writer={write:vi.fn(async()=>{}),close:vi.fn(async()=>{}),abort:vi.fn(async()=>{})};
 const picker=vi.fn(async()=>({createWritable:async()=>writer}));vi.stubGlobal('window',{showSaveFilePicker:picker});
 const sink=await editingExportSink('video.mp4');await sink.write(new Uint8Array([1]));
 expect(writer.close).not.toHaveBeenCalled();await sink.finish();expect(writer.close).toHaveBeenCalledOnce();
 await sink.abort();expect(writer.abort).toHaveBeenCalledOnce();
 expect(picker).toHaveBeenCalledWith(expect.objectContaining({suggestedName:'video.mp4'}));
});
it('does not fall back or write when the person cancels the picker',async()=>{
 const error=new Error('Canceled');error.name='AbortError';
 vi.stubGlobal('window',{showSaveFilePicker:vi.fn().mockRejectedValue(error)});
 await expect(editingExportSink('video.mp4')).rejects.toBe(error);
});
it('removes temporary storage when writer creation fails',async()=>{
 const removeEntry=vi.fn(async()=>{});
 vi.stubGlobal('window',{});vi.stubGlobal('navigator',{storage:{getDirectory:async()=>({getFileHandle:async()=>({createWritable:async()=>{throw new Error('No space');}}),removeEntry})}});
 await expect(editingExportSink('video.mp4')).rejects.toThrow('No space');expect(removeEntry).toHaveBeenCalledOnce();
});
it('downloads a committed fallback file and cleans it after the handoff window',async()=>{
 vi.useFakeTimers();const events:string[]=[],removeEntry=vi.fn(async()=>{}),file=new Blob(['video']);
 vi.stubGlobal('window',{});vi.stubGlobal('navigator',{storage:{getDirectory:async()=>({getFileHandle:async()=>({createWritable:async()=>({write:async()=>{events.push('write');},close:async()=>{events.push('close');},abort:async()=>{}}),getFile:async()=>{events.push('file');return file;}}),removeEntry})}});
 const link={href:'',download:'',click:()=>events.push('click'),remove:()=>{}};
 vi.stubGlobal('document',{createElement:()=>link,body:{appendChild:()=>{}}});
 const revokeObjectURL=vi.fn();vi.stubGlobal('URL',{createObjectURL:()=> 'blob:fixture',revokeObjectURL});
 const sink=await editingExportSink('final.mp4');await sink.write(new Uint8Array([1]));await sink.finish();
 expect(events).toEqual(['write','close','file','click']);expect(link.download).toBe('final.mp4');expect(removeEntry).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(60000);expect(removeEntry).toHaveBeenCalledOnce();expect(revokeObjectURL).toHaveBeenCalledWith('blob:fixture');
});
