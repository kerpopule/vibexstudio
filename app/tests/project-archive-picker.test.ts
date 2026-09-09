import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({pick:vi.fn(),input:vi.fn()}));
vi.mock('expo-document-picker',()=>({getDocumentAsync:state.pick}));
vi.mock('expo-file-system',()=>({File:class{constructor(public uri:string){}}}));
vi.mock('../src/lib/share/archive-input.native',()=>({nativeArchiveInput:state.input}));
vi.mock('../src/lib/share/save-project-archive.native',()=>({saveNativeProjectArchive:vi.fn()}));
vi.mock('../src/lib/share/restore-project-archive.native',()=>({restoreNativeProjectArchive:vi.fn()}));
vi.mock('../src/lib/share/save-project-archive.web',()=>({saveProjectDirectoryArchive:vi.fn()}));
vi.mock('../src/lib/storage/projects.web',()=>({restoreProjectDirectoryArchive:vi.fn()}));
import {pickProjectArchive as nativePick} from '../src/lib/share/project-archives';
import {pickProjectArchive as webPick} from '../src/lib/share/project-archives.web';
beforeEach(()=>{vi.clearAllMocks();state.input.mockReturnValue({size:100});});
it('opens a native provider URI without requiring a browser File or fetching a URL',async()=>{
 state.pick.mockResolvedValue({canceled:false,assets:[{name:'Project.vibexdir',uri:'content://user-chosen/archive/1'}]});
 const result=await nativePick();
 expect(result).toEqual({name:'Project.vibexdir',input:{size:100}});
 expect(state.input.mock.calls[0][0].uri).toBe('content://user-chosen/archive/1');
 expect(state.pick).toHaveBeenCalledWith(expect.objectContaining({copyToCacheDirectory:false}));
});
it('leaves state alone on native or browser picker cancellation',async()=>{
 state.pick.mockResolvedValue({canceled:true,assets:null});
 expect(await nativePick()).toBeNull();expect(await webPick()).toBeNull();
 expect(state.input).not.toHaveBeenCalled();
});
it('rejects an unrelated native selection before opening it',async()=>{
 state.pick.mockResolvedValue({canceled:false,assets:[{name:'photo.png',uri:'content://picked/photo'}]});
 await expect(nativePick()).rejects.toThrow('Choose a VibeX project archive');
 expect(state.input).not.toHaveBeenCalled();
});
it('retains browser File input and rejects a browser without readable data',async()=>{
 const file={name:'backup.zip',size:100,slice:vi.fn()};
 state.pick.mockResolvedValue({canceled:false,assets:[{file}]});
 expect(await webPick()).toEqual({name:'backup.zip',input:file});
 state.pick.mockResolvedValue({canceled:false,assets:[{name:'backup.zip'}]});
 await expect(webPick()).rejects.toThrow('readable archive');
});
