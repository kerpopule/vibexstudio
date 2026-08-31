import { describe, expect, it } from 'vitest';

import { parseReferoStyles } from '@/lib/design/refero-catalog';

const CARD = (id: string, name: string) => `
<a class="block rounded-4xl" href="/style/${id}"><div><div><div class="relative h-full w-full overflow-hidden bg-card">
<img alt="${name}" loading="lazy" decoding="async" class="object-fill" src="https://images.refero.design/styles/refero.design/image/${id}.jpg"/>
</div></div></div><div class="flex items-start gap-2 pt-2"><img src="https://t0.gstatic.com/faviconV2?x"/></div></a>`;

describe('parseReferoStyles', () => {
  it('parses id, name, url, and static image from card blocks', () => {
    const html = CARD('8b6b547f-a357-4f1b-9842-4579c62dd42b', 'Slush') + CARD('44e0b9d8-3ee4-42c6-83e3-e7189705bd16', 'Linear');
    const cards = parseReferoStyles(html);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual({
      id: '8b6b547f-a357-4f1b-9842-4579c62dd42b',
      url: 'https://styles.refero.design/style/8b6b547f-a357-4f1b-9842-4579c62dd42b',
      name: 'Slush',
      image: 'https://images.refero.design/styles/refero.design/image/8b6b547f-a357-4f1b-9842-4579c62dd42b.jpg',
    });
    expect(cards[1].name).toBe('Linear');
  });

  it('dedupes repeated ids and skips cards without a refero image', () => {
    const id = '8b6b547f-a357-4f1b-9842-4579c62dd42b';
    const noImage = `<a href="/style/${'a'.repeat(8)}-1111-2222-3333-444444444444"><div>no img here</div></a>`;
    const cards = parseReferoStyles(CARD(id, 'One') + CARD(id, 'One again') + noImage);
    expect(cards).toHaveLength(1);
  });

  it('returns empty for arbitrary HTML', () => {
    expect(parseReferoStyles('<html><body><p>hi</p></body></html>')).toEqual([]);
  });
});
