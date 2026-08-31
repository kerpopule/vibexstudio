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

describe('medialab fences', () => {
  it('parses a video request with a character', () => {
    const raw = [
      'Lights, camera!',
      '```medialab kind=video character=steve1 file=assets/intro.mp4',
      'Steve welcomes visitors to the site, warm and upbeat.',
      '```',
    ].join('\n');
    const out = parseAssistantReply(raw);
    expect(out.media).toEqual([
      {
        kind: 'video',
        character: 'steve1',
        file: 'assets/intro.mp4',
        prompt: 'Steve welcomes visitors to the site, warm and upbeat.',
      },
    ]);
    expect(out.files).toEqual([]);
    expect(out.text).toContain('🎬 Requested video → `assets/intro.mp4`');
    expect(out.text).not.toContain('warm and upbeat');
  });

  it('parses an image request without a character', () => {
    const raw = ['```medialab kind=image file=assets/hero.png', 'A neon skyline', '```'].join('\n');
    const out = parseAssistantReply(raw);
    expect(out.media).toEqual([{ kind: 'image', file: 'assets/hero.png', prompt: 'A neon skyline' }]);
  });

  it('a medialab fence is never treated as a project file', () => {
    const raw = ['```medialab kind=image file=assets/hero.png', 'A neon skyline', '```'].join('\n');
    expect(parseAssistantReply(raw).files).toEqual([]);
  });

  it('keeps a fence missing file= in the chat text', () => {
    const raw = ['```medialab kind=video', 'no target', '```'].join('\n');
    const out = parseAssistantReply(raw);
    expect(out.media).toEqual([]);
    expect(out.text).toContain('no target');
  });

  it('rejects path traversal and non-assets targets', () => {
    for (const file of ['../../etc/passwd.png', 'assets/../index.mp4', 'index.html', 'hero.png']) {
      const raw = [`\`\`\`medialab kind=image file=${file}`, 'x', '```'].join('\n');
      expect(parseAssistantReply(raw).media).toEqual([]);
    }
  });

  it('rejects a kind/extension mismatch and empty prompts', () => {
    expect(
      parseAssistantReply(['```medialab kind=video file=assets/a.png', 'x', '```'].join('\n')).media
    ).toEqual([]);
    expect(
      parseAssistantReply(['```medialab kind=image file=assets/a.png', '', '```'].join('\n')).media
    ).toEqual([]);
  });

  it('last request for the same file wins', () => {
    const raw = [
      '```medialab kind=image file=assets/a.png',
      'v1',
      '```',
      '```medialab kind=image file=assets/a.png',
      'v2',
      '```',
    ].join('\n');
    const out = parseAssistantReply(raw);
    expect(out.media).toEqual([{ kind: 'image', file: 'assets/a.png', prompt: 'v2' }]);
  });
});

describe('web fences', () => {
  it('parses a search fence (body ignored)', () => {
    const raw = ['Checking the docs first!', '```web search=chart.js cdn latest', '```'].join('\n');
    const out = parseAssistantReply(raw);
    expect(out.web).toEqual([{ type: 'search', query: 'chart.js cdn latest' }]);
    expect(out.files).toEqual([]);
    expect(out.text).toContain('🔎 Web search: `chart.js cdn latest`');
    expect(out.text).toContain('Checking the docs first!');
  });

  it('parses a url fence and ignores any body', () => {
    const raw = ['```web url=https://developer.mozilla.org/canvas', 'this body is ignored', '```'].join(
      '\n'
    );
    const out = parseAssistantReply(raw);
    expect(out.web).toEqual([{ type: 'fetch', url: 'https://developer.mozilla.org/canvas' }]);
    expect(out.text).toContain('📄 Web page: https://developer.mozilla.org/canvas');
    expect(out.text).not.toContain('this body is ignored');
  });

  it('collects multiple fences and de-dupes repeats (last wins, like files)', () => {
    const raw = [
      '```web search=a',
      '```',
      '```web url=https://a.com/x',
      '```',
      '```web search=A',
      '```',
    ].join('\n');
    const out = parseAssistantReply(raw);
    expect(out.web).toEqual([
      { type: 'search', query: 'A' },
      { type: 'fetch', url: 'https://a.com/x' },
    ]);
  });

  it('keeps invalid fences (http url, missing attr) in the chat text', () => {
    for (const info of ['url=http://insecure.com', 'lookup=cats', '']) {
      const raw = [`\`\`\`web ${info}`.trimEnd(), 'body', '```'].join('\n');
      const out = parseAssistantReply(raw);
      expect(out.web).toEqual([]);
      expect(out.text).toContain('body');
    }
  });

  it('a web fence is never treated as a project file', () => {
    const raw = ['```web url=https://a.com', '<!doctype html><html></html>', '```'].join('\n');
    const out = parseAssistantReply(raw);
    expect(out.files).toEqual([]);
    expect(out.web).toEqual([{ type: 'fetch', url: 'https://a.com' }]);
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
