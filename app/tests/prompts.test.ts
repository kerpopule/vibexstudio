import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from '@/lib/ai/prompts';

describe('buildSystemPrompt', () => {
  it('handles a brand new project', () => {
    const prompt = buildSystemPrompt('Timer', []);
    expect(prompt).toContain('"Timer"');
    expect(prompt).toContain('no files yet');
  });

  it('embeds text files and lists binary assets without contents', () => {
    const prompt = buildSystemPrompt('Timer', [
      { path: 'index.html', content: '<h1>hi</h1>', encoding: 'utf-8' },
      { path: 'assets/logo.png', content: 'aGVsbG8=', encoding: 'base64' },
    ]);
    expect(prompt).toContain('<h1>hi</h1>');
    expect(prompt).toContain('assets/logo.png (binary asset)');
    expect(prompt).not.toContain('aGVsbG8=');
  });

  it('makes build/edit requests require savable file blocks', () => {
    const prompt = buildSystemPrompt('Timer', []);
    expect(prompt).toContain('MUST output savable file blocks');
    expect(prompt).toContain('Do not answer with a plan, summary, promise, or normal chat first');
    expect(prompt).toContain('If you do not include at least one `file=` block on a build/edit request');
  });

  it('makes generated apps portable to GitHub Pages project paths', () => {
    const prompt = buildSystemPrompt('Timer', []);
    expect(prompt).toContain('relative URLs such as `./styles.css`');
    expect(prompt).toContain('Never use root-relative URLs such as `/styles.css`');
  });

  it('offers images only when no Media Lab is paired', () => {
    const prompt = buildSystemPrompt('Timer', []);
    expect(prompt).toContain('## Generated media (strict rules)');
    expect(prompt).toContain('kind=image ONLY');
    expect(prompt).toContain('Video generation is unavailable');
    expect(prompt).not.toContain('kind=video is available');
  });

  it('advertises video + real characters when a Media Lab is paired', () => {
    const prompt = buildSystemPrompt('Timer', [], {
      characters: [{ id: 'steve1', name: 'Steve' }],
    });
    expect(prompt).toContain('kind=video is available');
    expect(prompt).toContain('Steve (character=steve1)');
    expect(prompt).toContain('poster');
    expect(prompt).not.toContain('kind=image ONLY');
  });

  it('paired with no characters still offers video, without a cast list', () => {
    const prompt = buildSystemPrompt('Timer', [], { characters: [] });
    expect(prompt).toContain('kind=video is available');
    expect(prompt).not.toContain('You can feature these REAL people');
  });


});
