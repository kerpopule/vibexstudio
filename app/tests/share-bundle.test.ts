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

it('preserves GLB binary bytes across bundle encoding and decoding',()=>{
 const bytes=Buffer.from([0x67,0x6c,0x54,0x46,0,255,128,13,10,0,3]);
 const encoded=encodeBundle({name:'3D project',emoji:'🧊',description:'',files:[{path:'assets/chair.glb',content:bytes.toString('base64'),encoding:'base64'}]},1);
 const decoded=decodeBundle(encoded);
 expect(decoded.files[0].encoding).toBe('base64');
 expect(Buffer.from(decoded.files[0].content,'base64')).toEqual(bytes);
});

it('does not export bundles the same app cannot import',()=>{
 const base={name:'Large project',emoji:'📦',description:''};
 expect(()=>encodeBundle({...base,files:Array.from({length:501},(_,i)=>({path:`f${i}.txt`,content:'x'}))},1)).toThrow('too many');
 expect(()=>encodeBundle({...base,files:[{path:'big.txt',content:'x'.repeat(25_000_001)}]},1)).toThrow('too large');
 // JSON escaping can exceed the limit even if raw content fits.
 expect(()=>encodeBundle({...base,files:[{path:'escaped.txt',content:'"'.repeat(12_500_001)}]},1)).toThrow('too large');
});

it.each([
 ['assets/chair.glb','assets/chair.glb'],
 ['assets/Chair.glb','assets/chair.glb'],
 ['assets/caf\u00e9.glb','assets/cafe\u0301.glb'],
 ['assets','assets/chair.glb'],
])('rejects portable filesystem collisions: %s and %s',(a,b)=>{
 const files=[{path:a,content:'one'},{path:b,content:'two'}];
 expect(()=>encodeBundle({name:'Collision',emoji:'',description:'',files},1)).toThrow(/conflicting|file and a folder/);
 expect(()=>decodeBundle(JSON.stringify({format:BUNDLE_FORMAT,version:1,files}))).toThrow(/conflicting|file and a folder/);
});
