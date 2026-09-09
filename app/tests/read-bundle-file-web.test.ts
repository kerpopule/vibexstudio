import {afterEach,expect,it,vi} from 'vitest';
import {readBundleFile} from '@/lib/share/read-bundle-file.web';
afterEach(()=>vi.unstubAllGlobals());
it('reads a browser-picked data URL without native filesystem access',async()=>{
  expect(await readBundleFile('data:application/json,%7B%22name%22%3A%22Caf%C3%A9%22%7D')).toBe('{"name":"Café"}');
});
it('reads a blob URL from the browser picker',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('{"format":"vibex/bundle"}'));
  vi.stubGlobal('fetch',fetcher);
  expect(await readBundleFile('blob:http://localhost/fixture')).toContain('vibex/bundle');
});
it('rejects remote URLs on the local-file path before fetching',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await expect(readBundleFile('https://example.org/file')).rejects.toThrow('file picker');
  expect(fetcher).not.toHaveBeenCalled();
});
it('reports an expired or unavailable selected file',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:404})));
  await expect(readBundleFile('blob:http://localhost/expired')).rejects.toThrow('Choose it again');
});
