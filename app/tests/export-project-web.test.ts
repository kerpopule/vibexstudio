import {afterEach, expect, it, vi} from 'vitest';
import {exportProjectBundle} from '@/lib/share/exportProject.web';
import {decodeBundle} from '@/lib/share/bundle';
const storage=vi.hoisted(()=>({meta:vi.fn(),files:vi.fn()}));
vi.mock('@/lib/storage/projects',()=>({readProject:storage.meta,listFiles:storage.files}));
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks();});
it('downloads a portable bundle preserving copied binary media bytes',async()=>{
  vi.useFakeTimers();
  storage.meta.mockResolvedValue({name:'My game',emoji:'🎮'});
  storage.files.mockResolvedValue([{path:'assets/win.webm',content:'AAH/',encoding:'base64'}, {path:'index.html',content:'<video src="assets/win.webm"></video>'}]);
  let downloaded!:Blob;
  const create=vi.spyOn(URL,'createObjectURL').mockImplementation(blob=>{downloaded=blob as Blob;return 'blob:fixture';});
  const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  const link={href:'',download:'',style:{display:''},click:vi.fn(),remove:vi.fn()};
  vi.stubGlobal('document',{createElement:()=>link,body:{appendChild:vi.fn()}});
  await exportProjectBundle('project');
  expect(create).toHaveBeenCalledTimes(1);expect(link.click).toHaveBeenCalledTimes(1);
  expect(link.download).toMatch(/\.vibex$/);
  const bundle=decodeBundle(await downloaded.text());
  expect(bundle.files[0]).toMatchObject({path:'assets/win.webm',content:'AAH/',encoding:'base64'});
  expect(bundle.files[1].content).toContain('assets/win.webm');
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);expect(revoke).toHaveBeenCalledWith('blob:fixture');
});
it('refuses a missing project before constructing a download',async()=>{
  storage.meta.mockResolvedValue(null);
  await expect(exportProjectBundle('missing')).rejects.toThrow('Project not found');
});
