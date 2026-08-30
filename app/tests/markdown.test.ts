import { describe, expect, it } from 'vitest';

import { inlineToPlain, parseInline, parseMarkdown } from '../src/lib/markdown';

describe('parseMarkdown blocks', () => {
  it('splits paragraphs on blank lines and merges soft-wrapped lines', () => {
    const blocks = parseMarkdown('first line\nstill first\n\nsecond');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('paragraph');
    expect(inlineToPlain((blocks[0] as any).content)).toBe('first line still first');
  });

  it('parses fenced code blocks with language', () => {
    const blocks = parseMarkdown('```js\nconst a = 1;\nconst b = 2;\n```');
    expect(blocks).toEqual([{ type: 'code', lang: 'js', text: 'const a = 1;\nconst b = 2;' }]);
  });

  it('survives an unterminated fence', () => {
    const blocks = parseMarkdown('```\nhello');
    expect(blocks).toEqual([{ type: 'code', lang: null, text: 'hello' }]);
  });

  it('parses headings with levels', () => {
    const blocks = parseMarkdown('## Title');
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2 });
  });

  it('parses unordered and ordered lists', () => {
    const ul = parseMarkdown('- one\n- two');
    expect(ul[0]).toMatchObject({ type: 'list', ordered: false });
    expect((ul[0] as any).items).toHaveLength(2);

    const ol = parseMarkdown('1. one\n2) two');
    expect(ol[0]).toMatchObject({ type: 'list', ordered: true });
  });

  it('parses blockquotes', () => {
    const blocks = parseMarkdown('> wise words\n> more words');
    expect(blocks[0]).toMatchObject({ type: 'quote' });
    expect(inlineToPlain((blocks[0] as any).content)).toBe('wise words more words');
  });

  it('does not treat list/heading markers inside code fences as blocks', () => {
    const blocks = parseMarkdown('```\n- not a list\n# not a heading\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code');
  });
});

describe('parseInline', () => {
  it('parses bold', () => {
    expect(parseInline('a **b** c')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' c' },
    ]);
  });

  it('parses italic with * and _', () => {
    expect(parseInline('*it*')[0]).toMatchObject({ type: 'italic' });
    expect(parseInline('_it_')[0]).toMatchObject({ type: 'italic' });
  });

  it('parses inline code and protects it from other formatting', () => {
    expect(parseInline('use `**not bold**` here')).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'code', text: '**not bold**' },
      { type: 'text', text: ' here' },
    ]);
  });

  it('parses links', () => {
    expect(parseInline('[Expo](https://expo.dev)')).toEqual([
      { type: 'link', text: 'Expo', href: 'https://expo.dev' },
    ]);
  });

  it('nests italic inside bold', () => {
    const [bold] = parseInline('**a *b* c**');
    expect(bold).toMatchObject({ type: 'bold' });
    expect(inlineToPlain((bold as any).children)).toBe('a b c');
  });

  it('leaves stray asterisks alone', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', text: '2 * 3 = 6' }]);
  });
});
