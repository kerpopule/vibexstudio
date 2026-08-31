import { describe, expect, it } from 'vitest';

import {
  describeWorkbenchPhase,
  findJobOutcome,
  findRunOutcome,
  isLongRunningTask,
  isSafeWorkbenchPath,
  shortLogTail,
  workbenchPreviewUrl,
  workbenchRunPlan,
  type WorkbenchEvent,
} from '../src/lib/workbench-core';

describe('workbenchRunPlan', () => {
  it('serves plain static projects with the built-in server', () => {
    expect(workbenchRunPlan([{ path: 'index.html' }, { path: 'css/app.css' }])).toEqual(['serve']);
    expect(workbenchRunPlan([])).toEqual(['serve']);
  });

  it('installs then runs dev when package.json is at the root', () => {
    expect(workbenchRunPlan([{ path: 'package.json' }, { path: 'src/main.ts' }])).toEqual([
      'install',
      'dev',
    ]);
  });

  it('ignores nested package.json files', () => {
    expect(workbenchRunPlan([{ path: 'vendor/package.json' }, { path: 'index.html' }])).toEqual([
      'serve',
    ]);
  });
});

describe('isLongRunningTask', () => {
  it('marks dev and serve long-running, the rest not', () => {
    expect(isLongRunningTask('dev')).toBe(true);
    expect(isLongRunningTask('serve')).toBe(true);
    expect(isLongRunningTask('install')).toBe(false);
    expect(isLongRunningTask('build')).toBe(false);
    expect(isLongRunningTask('stop-dev')).toBe(false);
  });
});

describe('workbenchPreviewUrl', () => {
  it('builds the tokenized preview URL', () => {
    expect(workbenchPreviewUrl('http://mac.local:8794', 'abc-123', 'deadbeef')).toBe(
      'http://mac.local:8794/preview/abc-123/?wbt=deadbeef'
    );
  });

  it('encodes awkward ids and tokens, and trims trailing slashes', () => {
    expect(workbenchPreviewUrl('http://mac:8794///', 'a b', 't&k')).toBe(
      'http://mac:8794/preview/a%20b/?wbt=t%26k'
    );
  });
});

describe('isSafeWorkbenchPath', () => {
  it('accepts normal relative paths', () => {
    expect(isSafeWorkbenchPath('index.html')).toBe(true);
    expect(isSafeWorkbenchPath('src/components/app.tsx')).toBe(true);
    expect(isSafeWorkbenchPath('assets/img.png')).toBe(true);
  });

  it('rejects traversal, absolute, and windows-style paths', () => {
    expect(isSafeWorkbenchPath('../secrets.txt')).toBe(false);
    expect(isSafeWorkbenchPath('a/../../b')).toBe(false);
    expect(isSafeWorkbenchPath('/etc/passwd')).toBe(false);
    expect(isSafeWorkbenchPath('C:/windows/system32')).toBe(false);
    expect(isSafeWorkbenchPath('a\\b')).toBe(false);
  });

  it('rejects empty, dotted, and doubled segments', () => {
    expect(isSafeWorkbenchPath('')).toBe(false);
    expect(isSafeWorkbenchPath('./a')).toBe(false);
    expect(isSafeWorkbenchPath('a//b')).toBe(false);
    expect(isSafeWorkbenchPath('a/')).toBe(false);
  });
});

const events: WorkbenchEvent[] = [
  { seq: 1, type: 'job-done', project: 'other', jobId: 'j0' },
  { seq: 2, type: 'job-failed', project: 'other', jobId: 'j1', task: 'build' },
  { seq: 3, type: 'dev-up', project: 'mine', port: 4173 },
];

describe('findRunOutcome', () => {
  it('finds dev-up for the right project only', () => {
    expect(findRunOutcome(events, 'mine')).toEqual({ kind: 'dev-up', port: 4173 });
    expect(findRunOutcome(events, 'missing')).toBeNull();
  });

  it('surfaces a job failure for the project', () => {
    expect(findRunOutcome(events, 'other')).toEqual({
      kind: 'job-failed',
      jobId: 'j1',
      task: 'build',
    });
  });
});

describe('findJobOutcome', () => {
  it('matches by job id', () => {
    expect(findJobOutcome(events, 'j0')).toBe('done');
    expect(findJobOutcome(events, 'j1')).toBe('failed');
    expect(findJobOutcome(events, 'jX')).toBeNull();
  });
});

describe('describeWorkbenchPhase', () => {
  it('has a human label per phase', () => {
    expect(describeWorkbenchPhase('importing')).toMatch(/computer/);
    expect(describeWorkbenchPhase('install')).toMatch(/Installing/);
    expect(describeWorkbenchPhase('dev')).toMatch(/dev server/);
    expect(describeWorkbenchPhase('serve')).toMatch(/server/);
  });
});

describe('shortLogTail', () => {
  it('passes short tails through and nulls empties', () => {
    expect(shortLogTail('npm ERR! boom')).toBe('npm ERR! boom');
    expect(shortLogTail('   ')).toBeNull();
    expect(shortLogTail(undefined)).toBeNull();
  });

  it('keeps the END of a long tail (that is where the error lives)', () => {
    const tail = `${'x'.repeat(500)}THE-ERROR`;
    const short = shortLogTail(tail, 100);
    expect(short).toHaveLength(101); // ellipsis + 100 chars
    expect(short?.endsWith('THE-ERROR')).toBe(true);
  });
});
