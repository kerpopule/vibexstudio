import {afterEach, expect, it, vi} from 'vitest';
import {sendToCut} from '@/lib/medialab-cut';
import type {GalleryItem} from '@/lib/types';

const link = {url: 'https://lab.example', addedAt: 1};
const item = {id:'fixture',kind:'image',mimeType:'image/png',uri:'data:image/png;base64,AA==',prompt:'A scene'} as GalleryItem;
afterEach(() => vi.unstubAllGlobals());

it('does not upload media to a controller without an editor website', async () => {
  const request = vi.fn(async (_url: string) => new Response(JSON.stringify({vibexStudio:{version:1,webInterface:false}})));
  vi.stubGlobal('fetch', request);
  await expect(sendToCut(link, item)).rejects.toThrow('no Cut editor');
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toBe('https://lab.example/manifest.json');
});

it('does not upload media when the server cannot be checked', async () => {
  const request = vi.fn(async () => {throw new Error('offline');});
  vi.stubGlobal('fetch', request);
  await expect(sendToCut(link, item)).rejects.toThrow('Could not reach Media Lab');
  expect(request).toHaveBeenCalledTimes(1);
});

it('preserves the Cut project destination after an older server accepts the upload', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(new Response('{}'))
    .mockResolvedValueOnce(new Response(new Uint8Array([0]),{headers:{'Content-Type':'image/png'}}))
    .mockResolvedValueOnce(new Response(JSON.stringify({id:'uploaded-image'})))
    .mockResolvedValueOnce(new Response(JSON.stringify({project_id:'project one'})));
  vi.stubGlobal('fetch', request);
  await expect(sendToCut(link, item)).resolves.toBe('https://lab.example/cut?project=project%20one');
  expect(request.mock.calls[2][0]).toBe('https://lab.example/api/upload');
  expect(JSON.parse(request.mock.calls[3][1].body)).toEqual({job_ids:['uploaded-image'],name:'A scene'});
});
