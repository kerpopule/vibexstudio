import { describe, expect, it } from 'vitest';

import { looksLikeHtmlPage, normalizeShareLink } from '@/lib/share/cloudLinks';

describe('normalizeShareLink', () => {
  it('forces Dropbox share pages into direct downloads', () => {
    const link = normalizeShareLink('https://www.dropbox.com/scl/fi/abc123/My%20App.vibex?rlkey=xyz&dl=0');
    expect(link).toEqual({
      kind: 'direct',
      url: expect.stringContaining('dl=1'),
    });
  });

  it('unwraps Google Drive viewer links', () => {
    const link = normalizeShareLink('https://drive.google.com/file/d/1AbC_dEf-9/view?usp=sharing');
    expect(link).toEqual({
      kind: 'direct',
      url: 'https://drive.google.com/uc?export=download&id=1AbC_dEf-9',
    });
  });

  it('unwraps Google Drive open?id links', () => {
    const link = normalizeShareLink('https://drive.google.com/open?id=99ZZ');
    expect(link).toEqual({ kind: 'direct', url: 'https://drive.google.com/uc?export=download&id=99ZZ' });
  });


  it('passes plain URLs through', () => {
    const link = normalizeShareLink('https://example.com/files/app.vibex');
    expect(link).toEqual({ kind: 'direct', url: 'https://example.com/files/app.vibex' });
  });

  it('unwraps our own deep link with an embedded url', () => {
    const inner = encodeURIComponent('https://drive.google.com/file/d/42xyz/view');
    const link = normalizeShareLink(`vibex://import?url=${inner}`);
    expect(link).toEqual({ kind: 'direct', url: 'https://drive.google.com/uc?export=download&id=42xyz' });
  });

  it('rejects non-URLs and weird protocols', () => {
    expect(normalizeShareLink('')).toBeNull();
    expect(normalizeShareLink('not a link')).toBeNull();
    expect(normalizeShareLink('ftp://example.com/x.vibex')).toBeNull();
    expect(normalizeShareLink('javascript:alert(1)')).toBeNull();
  });
});

describe('looksLikeHtmlPage', () => {
  it('flags HTML interstitials', () => {
    expect(looksLikeHtmlPage('<!DOCTYPE html><html><body>sign in</body></html>')).toBe(true);
    expect(looksLikeHtmlPage('  <html lang="en">')).toBe(true);
  });

  it('passes JSON bundles', () => {
    expect(looksLikeHtmlPage('{"format":"vibex/bundle"}')).toBe(false);
  });

  it('passes bundles whose inlined app files contain HTML (regression)', () => {
    const bundle = JSON.stringify({
      format: 'vibex/bundle',
      version: 1,
      files: [{ path: 'index.html', content: '<!doctype html><html><head></head></html>', encoding: 'utf-8' }],
    });
    expect(looksLikeHtmlPage(bundle)).toBe(false);
  });
});
