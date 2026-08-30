/**
 * Tiny markdown parser for chat rendering. Covers what models actually emit
 * in conversation: paragraphs, headings, fenced code, inline code, bold,
 * italic, links, lists, and blockquotes. Pure logic — no React — so it's
 * unit-tested alongside the other src/lib modules.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'italic'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string };

export type Block =
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'heading'; level: number; content: Inline[] }
  | { type: 'code'; lang: string | null; text: string }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; content: Inline[] };

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block.
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence (or EOF)
      blocks.push({ type: 'code', lang: fence[1] || null, text: body.join('\n') });
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, content: parseInline(heading[2]) });
      i++;
      continue;
    }

    // Blockquote (consecutive > lines merge).
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', content: parseInline(quoted.join(' ')) });
      continue;
    }

    // List (unordered - * + or ordered 1. 2.).
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const items: Inline[][] = [];
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph: merge consecutive plain lines.
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', content: parseInline(para.join(' ')) });
  }

  return blocks;
}

/** Inline tokenizer: `code` wins over everything; then bold, italic (star or underscore), links. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;

  const TOKEN = /(`[^`]+`)|(\*\*(?:[^*]|\*(?!\*))+\*\*)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/;

  while (rest.length > 0) {
    const match = rest.match(TOKEN);
    if (!match || match.index === undefined) {
      out.push({ type: 'text', text: rest });
      break;
    }
    if (match.index > 0) {
      out.push({ type: 'text', text: rest.slice(0, match.index) });
    }
    const token = match[0];
    if (token.startsWith('`')) {
      out.push({ type: 'code', text: token.slice(1, -1) });
    } else if (token.startsWith('**')) {
      out.push({ type: 'bold', children: parseInline(token.slice(2, -2)) });
    } else if (token.startsWith('*') || token.startsWith('_')) {
      out.push({ type: 'italic', children: parseInline(token.slice(1, -1)) });
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) out.push({ type: 'link', text: link[1], href: link[2] });
      else out.push({ type: 'text', text: token });
    }
    rest = rest.slice(match.index + token.length);
  }

  return out;
}

/** Flatten inline nodes back to plain text (for accessibility labels, previews). */
export function inlineToPlain(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
        case 'code':
          return n.text;
        case 'link':
          return n.text;
        case 'bold':
        case 'italic':
          return inlineToPlain(n.children);
      }
    })
    .join('');
}
