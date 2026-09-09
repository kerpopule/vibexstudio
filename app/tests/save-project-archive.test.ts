// These fixtures have no Sparky state; portable history has separate integration coverage.
vi.mock('../src/lib/director-project-history',()=>({checkpointDirectorProject:async()=>{}}));
import {it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({sink:vi.fn(),stage:vi.fn(),write:vi.fn()}));
vi.mock('../src/lib/editing-export-sink',()=>({editingExportSink:mocks.sink}));
vi.mock('../src/lib/storage/projects.web',()=>({stageProjectDirectoryArchive:mocks.stage}));
vi.mock('../src/lib/share/project-directory-archive',()=>({writeProjectDirectoryArchive:mocks.write}));
import {saveProjectDirectoryArchive} from '../src/lib/share/save-project-archive.web';
beforeEach(()=>vi.resetAllMocks());
it('chooses an archive destination before staging and reports completed save separately from cleanup',async()=>{
 const abort=vi.fn(),dispose=vi.fn().mockRejectedValue(new Error('disk busy'));
 mocks.sink.mockResolvedValue({abort});mocks.stage.mockResolvedValue({entries:'fixture',dispose});mocks.write.mockResolvedValue({files:2,bytes:100,archiveBytes:300});
 expect(await saveProjectDirectoryArchive('p1')).toMatchObject({files:2,temporaryCleanupComplete:false});
 expect(mocks.sink.mock.calls[0][1]).toMatchObject({mimeType:'application/zip',extension:'.vibexdir'});
 expect(mocks.sink.mock.invocationCallOrder[0]).toBeLessThan(mocks.stage.mock.invocationCallOrder[0]);
 expect(dispose).toHaveBeenCalledOnce();expect(abort).not.toHaveBeenCalled();
});
it('cancellation never stages and staging failure aborts the destination',async()=>{
 mocks.sink.mockRejectedValueOnce(new Error('cancelled'));
 await expect(saveProjectDirectoryArchive('p1')).rejects.toThrow('cancelled');expect(mocks.stage).not.toHaveBeenCalled();
 const abort=vi.fn(async()=>{});mocks.sink.mockResolvedValue({abort});mocks.stage.mockRejectedValue(new Error('quota'));
 await expect(saveProjectDirectoryArchive('p1')).rejects.toThrow('quota');expect(abort).toHaveBeenCalledOnce();
});
it('preserves export failure while disposing its staged copy',async()=>{
 const dispose=vi.fn(async()=>{});mocks.sink.mockResolvedValue({});mocks.stage.mockResolvedValue({entries:'fixture',dispose});mocks.write.mockRejectedValue(new Error('source damaged'));
 await expect(saveProjectDirectoryArchive('p1')).rejects.toThrow('source damaged');expect(dispose).toHaveBeenCalledOnce();
});
