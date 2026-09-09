import {describe, expect, it, vi} from 'vitest';
import {createLegacyQueueSupport} from '../src/lib/media-queue-support';

describe('legacy queue discovery', () => {
  it('honors the independent declaration and caches by origin', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({vibexStudio:{version:1,legacyQueue:false}})));
    const supports = createLegacyQueueSupport(fetcher);
    expect(await supports('https://lab.example/path')).toBe(false);
    expect(await supports('https://lab.example/other')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://lab.example/manifest.json');
    expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',redirect:'error'});
  });

  it('preserves known independent status during an outage and refreshes after recovery', async () => {
    let now = 0;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({vibexStudio:{version:1,legacyQueue:false}})))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({name:'Older server'})));
    const supports = createLegacyQueueSupport(fetcher, () => now);
    expect(await supports('https://lab.example')).toBe(false);
    now += 60_000;
    expect(await supports('https://lab.example')).toBe(false);
    now += 60_000;
    expect(await supports('https://lab.example')).toBe(true);
  });

  it.each([{}, {vibexStudio:{version:2,legacyQueue:false}}, {vibexStudio:{version:1,legacyQueue:'false'}}])(
    'keeps old or unknown manifests compatible: %j', async manifest => {
      const supports = createLegacyQueueSupport(vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest))));
      expect(await supports('https://old.example')).toBe(true);
    });

  it('does not disable an unknown legacy server because its manifest is unavailable', async () => {
    const supports = createLegacyQueueSupport(vi.fn().mockResolvedValue(new Response('', {status:404})));
    expect(await supports('https://old.example')).toBe(true);
  });
});
