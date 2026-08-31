import { describe, expect, it } from 'vitest';

import {
  absoluteMediaUrl,
  addPendingJob,
  buildImageJobBody,
  buildVideoJobBody,
  isValidMediaTarget,
  matchFinishedJobs,
  pendingMarkerPath,
  retryPendingJob,
  type PendingMediaJob,
} from '@/lib/medialab-core';

const job = (over: Partial<PendingMediaJob> = {}): PendingMediaJob => ({
  jobId: 'j1',
  projectId: 'p1',
  targetPath: 'assets/intro.mp4',
  kind: 'video',
  prompt: 'Steve gives an intro',
  createdAt: Date.now(),
  ...over,
});

describe('media targets', () => {
  it('accepts assets/ paths with a matching extension', () => {
    expect(isValidMediaTarget('video', 'assets/intro.mp4')).toBe(true);
    expect(isValidMediaTarget('image', 'assets/hero.png')).toBe(true);
    expect(isValidMediaTarget('image', 'assets/hero.jpg')).toBe(true);
  });

  it('rejects wrong extension, nesting, and non-assets paths', () => {
    expect(isValidMediaTarget('video', 'assets/intro.png')).toBe(false);
    expect(isValidMediaTarget('image', 'assets/hero.mp4')).toBe(false);
    expect(isValidMediaTarget('image', 'hero.png')).toBe(false);
    expect(isValidMediaTarget('image', 'assets/sub/hero.png')).toBe(false);
    expect(isValidMediaTarget('video', 'index.html')).toBe(false);
  });
});

describe('server job bodies', () => {
  const video = { kind: 'video' as const, file: 'assets/intro.mp4', prompt: 'Steve gives an intro' };
  const image = { kind: 'image' as const, file: 'assets/hero.png', prompt: 'Steve gives an intro' };

  it('video: prompt + engine, cast only when a character was named', () => {
    expect(buildVideoJobBody(video)).toEqual({ prompt: 'Steve gives an intro', model: 'ltx25' });
    expect(buildVideoJobBody({ ...video, character: 'steve1' })).toEqual({
      prompt: 'Steve gives an intro',
      model: 'ltx25',
      cast: ['steve1'],
    });
  });

  it('image: minimal prompt body with optional cast', () => {
    expect(buildImageJobBody(image)).toEqual({ prompt: 'Steve gives an intro' });
    expect(buildImageJobBody({ ...image, character: 'c9' })).toEqual({
      prompt: 'Steve gives an intro',
      cast: ['c9'],
    });
  });
});

describe('pending list', () => {
  it('adds jobs de-duped by id and bounded', () => {
    let list = addPendingJob([], job());
    list = addPendingJob(list, job({ prompt: 'v2' }));
    expect(list).toHaveLength(1);
    expect(list[0].prompt).toBe('v2');
  });

  it('splits history into resolved / failed / remaining', () => {
    const list = [job(), job({ jobId: 'j2' }), job({ jobId: 'j3' }), job({ jobId: 'j4' })];
    const { resolved, failed, remaining } = matchFinishedJobs(list, [
      { id: 'j1', status: 'done', url: '/media/out.mp4' },
      { id: 'j2', status: 'error' },
      { id: 'j3', status: 'done' }, // done without a url is a failure
    ]);
    expect(resolved).toEqual([{ job: list[0], url: '/media/out.mp4' }]);
    expect(failed.map((j) => j.jobId)).toEqual(['j2', 'j3']);
    expect(remaining.map((j) => j.jobId)).toEqual(['j4']);
  });

  it('drops entries older than 24h', () => {
    const stale = job({ createdAt: Date.now() - 25 * 60 * 60 * 1000 });
    const { resolved, failed, remaining } = matchFinishedJobs([stale], []);
    expect(resolved).toEqual([]);
    expect(failed).toEqual([]);
    expect(remaining).toEqual([]);
  });

  it('bounds download retries', () => {
    let j: PendingMediaJob | null = job();
    const attempts: number[] = [];
    while ((j = retryPendingJob(j))) attempts.push(j.attempts ?? 0);
    expect(attempts).toEqual([1, 2, 3, 4]);
  });
});

describe('paths and urls', () => {
  it('marker path sits beside the promised file', () => {
    expect(pendingMarkerPath('assets/intro.mp4')).toBe('assets/intro.mp4.pending.txt');
  });

  it('absolutizes server-relative result urls', () => {
    expect(absoluteMediaUrl('http://lab:7863/', '/media/out.mp4')).toBe('http://lab:7863/media/out.mp4');
    expect(absoluteMediaUrl('http://lab:7863', 'https://cdn/x.mp4')).toBe('https://cdn/x.mp4');
  });
});
