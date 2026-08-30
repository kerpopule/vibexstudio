import { describe, expect, it } from 'vitest';

import { assertSafePath, BUNDLE_FORMAT, bundleFileName, decodeBundle, encodeBundle } from '@/lib/share/bundle';
import type { ProjectFile } from '@/lib/types';

const FILES: ProjectFile[] = [
  { path: 'index.html', content: '<h1>hi</h1>', encoding: 'utf-8' },
  { path: 'assets/logo.png', content: 'aGVsbG8=', encoding: 'base64' },
];

describe('vibex bundle codec', () => {
  it('round-trips a project', () => {
    const text = encodeBundle({ name: 'Pomodoro', emoji: '⏱️', description: 'timer', files: FILES }, 1234);
    const decoded = decodeBundle(text);
    expect(decoded.name).toBe('Pomodoro');
    expect(decoded.emoji).toBe('⏱️');
    expect(decoded.description).toBe('timer');
    expect(decoded.files).toEqual(FILES);
    expect(JSON.parse(text).format).toBe(BUNDLE_FORMAT);
    expect(JSON.parse(text).exportedAt).toBe(1234);
  });

  it('rejects non-bundle JSON and non-JSON', () => {
    expect(() => decodeBundle('{"hello":"world"}')).toThrow(/isn't a VibeX app bundle/);
    expect(() => decodeBundle('<!doctype html><html></html>')).toThrow(/isn't a VibeX app bundle/);
  });

  it('rejects bundles from a newer format version', () => {
    const text = JSON.stringify({ format: BUNDLE_FORMAT, version: 99, files: FILES });
    expect(() => decodeBundle(text)).toThrow(/newer VibeXStudio/);
  });

  it('rejects empty bundles', () => {
    const text = JSON.stringify({ format: BUNDLE_FORMAT, version: 1, files: [] });
    expect(() => decodeBundle(text)).toThrow(/no app files/);
  });

  it('rejects path traversal and absolute-ish paths', () => {
    for (const path of ['../evil.html', 'a/../../b', 'a\\b.html', 'a/./b']) {
      const text = JSON.stringify({
        format: BUNDLE_FORMAT,
        version: 1,
        files: [{ path, content: 'x', encoding: 'utf-8' }],
      });
      expect(() => decodeBundle(text)).toThrow(/unsafe path/);
    }
  });

  it('strips leading slashes instead of rejecting', () => {
    expect(assertSafePath('/index.html')).toBe('index.html');
  });

  it('defaults missing meta fields sensibly', () => {
    const text = JSON.stringify({ format: BUNDLE_FORMAT, version: 1, files: FILES });
    const decoded = decodeBundle(text);
    expect(decoded.name).toBe('Shared app');
    expect(decoded.emoji).toBe('📦');
    expect(decoded.description).toBe('');
  });

  it('builds share-sheet-safe file names', () => {
    expect(bundleFileName('My Habit Tracker')).toBe('My Habit Tracker.vibex');
    expect(bundleFileName('  weird/?:*name  ')).toBe('weirdname.vibex');
    expect(bundleFileName('///')).toBe('VibeX app.vibex');
  });
});
