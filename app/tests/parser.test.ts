import { describe, expect, it } from 'vitest';

import { parseAssistantReply, sanitizePath } from '@/lib/ai/parser';

describe('parseAssistantReply', () => {
  it('extracts a single file block and keeps commentary', () => {
    const raw = [
      'Here is your timer app!',
      '',
      '```html file=index.html',
      '<!doctype html>',
      '<h1>Timer</h1>',
      '```',
      '',
      'Try the start button.',
    ].join('\n');

    const parsed = parseAssistantReply(raw);
    expect(parsed.files).toEqual([
      { path: 'index.html', content: '<!doctype html>\n<h1>Timer</h1>\n' },
    ]);
    expect(parsed.text).toContain('Here is your timer app!');
    expect(parsed.text).toContain('📄 Updated `index.html`');
    expect(parsed.text).toContain('Try the start button.');
    expect(parsed.text).not.toContain('<!doctype html>');
  });

  it('supports file:, path=, and bare fence variants', () => {
    const raw = [
      '```file:app.js',
      'console.log(1)',
      '```',
      '```css path=styles/main.css',
      'body{}',
      '```',
    ].join('\n');

    const parsed = parseAssistantReply(raw);
    expect(parsed.files.map((f) => f.path)).toEqual(['app.js', 'styles/main.css']);
  });

  it('keeps regular code blocks (no file attr) in the text', () => {
    const raw = ['Use this snippet:', '```js', 'alert(1)', '```'].join('\n');
    const parsed = parseAssistantReply(raw);
    expect(parsed.files).toEqual([]);
    expect(parsed.text).toContain('alert(1)');
  });

  it('last duplicate path wins', () => {
    const raw = [
      '```html file=index.html',
      'v1',
      '```',
      '```html file=index.html',
      'v2',
      '```',
    ].join('\n');
    const parsed = parseAssistantReply(raw);
    expect(parsed.files).toEqual([{ path: 'index.html', content: 'v2\n' }]);
  });

  it('handles an unterminated fence at the end of output', () => {
    const raw = ['```html file=index.html', '<h1>partial</h1>'].join('\n');
    const parsed = parseAssistantReply(raw);
    expect(parsed.files).toEqual([{ path: 'index.html', content: '<h1>partial</h1>\n' }]);
  });

  it('rejects traversal and absolute paths', () => {
    const raw = ['```html file=../../etc/passwd', 'x', '```'].join('\n');
    const parsed = parseAssistantReply(raw);
    expect(parsed.files).toEqual([]);
  });

  it('names a plain block from the filename line above it (Grok-style)', () => {
    const raw = 'Here you go!\n\n**index.html**\n```html\n<h1>hi</h1>\n```\nEnjoy!';
    const out = parseAssistantReply(raw);
    expect(out.files).toEqual([{ path: 'index.html', content: '<h1>hi</h1>\n' }]);
    expect(out.text).not.toContain('**index.html**');
  });

  it('names a heading-styled css file above a plain fence', () => {
    const raw = '### style.css\n```css\nbody { color: red }\n```';
    const out = parseAssistantReply(raw);
    expect(out.files[0]?.path).toBe('style.css');
  });

  it('treats an unattributed full html page as index.html (Grok-style)', () => {
    const raw = 'Built it!\n```html\n<!doctype html>\n<html><body>app</body></html>\n```';
    const out = parseAssistantReply(raw);
    expect(out.files[0]?.path).toBe('index.html');
    expect(out.files[0]?.content).toContain('<!doctype html>');
  });

  it('keeps ordinary snippets as chat text', () => {
    const raw = 'Use this:\n```js\nconsole.log(1)\n```';
    const out = parseAssistantReply(raw);
    expect(out.files).toEqual([]);
    expect(out.text).toContain('console.log(1)');
  });
});

describe('sanitizePath' , () => {
  it('accepts normal relative paths', () => {
    expect(sanitizePath('index.html')).toBe('index.html');
    expect(sanitizePath('./assets/img 1.png')).toBe('assets/img 1.png');
  });

  it('normalizes a leading slash into the project dir', () => {
    expect(sanitizePath('/index.html')).toBe('index.html');
  });

  it('rejects escapes', () => {
    expect(sanitizePath('a/../b')).toBeNull();
    expect(sanitizePath('a//b')).toBeNull();
    expect(sanitizePath('')).toBeNull();
    expect(sanitizePath('a\\b')).toBeNull();
  });
});
