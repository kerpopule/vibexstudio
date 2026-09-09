import { expect, it } from 'vitest';
import { retryRequest } from '@/lib/retry-request';
import type { ChatMessage } from '@/lib/types';
const message = (text: string): ChatMessage => ({id:'u',role:'user',text,createdAt:0});
it('preserves legacy media modes and multiline prompts', () => {
  for (const mode of ['image','video'] as const) {
    expect(retryRequest(message(`Generate ${mode}: First line\nSecond line`)))
      .toEqual({mode,prompt:'First line\nSecond line'});
  }
});
it('uses explicit intent instead of interpreting a coding prompt as a media request', () => {
  const prompt = 'Generate image: is the label I want on my button';
  expect(retryRequest({...message(prompt),request:{mode:'chat',prompt}}))
    .toEqual({mode:'chat',prompt});
  expect(retryRequest(message('Build a game')).mode).toBe('chat');
});
it('retains the original media prompt independently of display text', () => {
  expect(retryRequest({...message('Translated display'),request:{mode:'video',prompt:'A calm sea'}}))
    .toEqual({mode:'video',prompt:'A calm sea'});
});
