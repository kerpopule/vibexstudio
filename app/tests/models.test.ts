import { describe, expect, it } from 'vitest';

import { shortModelLabel } from '@/lib/ai/model-label';

describe('shortModelLabel', () => {
  it('strips vendor prefixes and shortens common ids', () => {
    expect(shortModelLabel('anthropic/claude-sonnet-4.6')).toBe('Sonnet 4.6');
    expect(shortModelLabel('claude-sonnet-4-6')).toBe('Sonnet 4.6');
    expect(shortModelLabel('claude-opus-4-8')).toBe('Opus 4.8');
    expect(shortModelLabel('grok-4.3')).toBe('Grok 4.3');
    expect(shortModelLabel('x-ai/grok-4.3')).toBe('Grok 4.3');
    expect(shortModelLabel('glm-5.2')).toBe('GLM 5.2');
    expect(shortModelLabel('gpt-5.2')).toBe('GPT-5.2');
    expect(shortModelLabel('gemini-3-pro')).toBe('Gemini 3 pro');
    expect(shortModelLabel('MiniMax-M3')).toBe('MiniMax M3');
    expect(shortModelLabel('kimi-for-coding')).toBe('Kimi for coding');
  });

  it('falls back to the raw base id for unknown vendors', () => {
    expect(shortModelLabel('some-weird-model')).toBe('some-weird-model');
    expect(shortModelLabel('')).toBe('model');
  });
});
