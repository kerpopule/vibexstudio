import { describe, expect, it } from 'vitest';

import { turnLimitForMemory } from '@/lib/turn-limits';

const GB = 1024 * 1024 * 1024;

describe('turnLimitForMemory', () => {
  it('never limits to a single turn', () => {
    expect(turnLimitForMemory(1 * GB)).toBeGreaterThanOrEqual(2);
    expect(turnLimitForMemory(0)).toBeGreaterThanOrEqual(2);
  });

  it('assumes mid-range when the platform does not report memory', () => {
    expect(turnLimitForMemory(null)).toBe(3);
  });

  it('scales with hardware', () => {
    expect(turnLimitForMemory(3 * GB)).toBe(2);
    expect(turnLimitForMemory(4 * GB)).toBe(3);
    expect(turnLimitForMemory(6 * GB)).toBe(3);
    expect(turnLimitForMemory(8 * GB)).toBe(4);
    expect(turnLimitForMemory(16 * GB)).toBe(4);
  });

  it('treats marketed sizes generously (usable memory is under the sticker)', () => {
    expect(turnLimitForMemory(7.6 * GB)).toBe(4);
    expect(turnLimitForMemory(3.6 * GB)).toBe(3);
  });
});
