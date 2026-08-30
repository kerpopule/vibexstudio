import { describe, expect, it } from 'vitest';

import { expectsFileOutput, resolveAssistantText } from '../src/lib/ai/turn-intent';

describe('expectsFileOutput', () => {
  it('expects files for a first-turn app brief but not greetings or information questions', () => {
    expect(expectsFileOutput('A cozy timer', false)).toBe(true);
    expect(expectsFileOutput('Build a cozy timer', false)).toBe(true);
    expect(expectsFileOutput('hello', false)).toBe(false);
    expect(expectsFileOutput('What can you build?', false)).toBe(false);
  });

  it('treats explicit build and edit requests as implementation', () => {
    expect(expectsFileOutput('change the background to blue', true)).toBe(true);
    expect(expectsFileOutput('Can you make the button bigger?', true)).toBe(true);
    expect(expectsFileOutput('move that above the card', true)).toBe(true);
  });

  it('does not mistake questions containing coding verbs for edit requests', () => {
    expect(expectsFileOutput('How do I change the theme myself?', true)).toBe(false);
    expect(expectsFileOutput('Why did you make the header fixed?', true)).toBe(false);
    expect(expectsFileOutput('Should I use CSS grid?', true)).toBe(false);
  });

  it('treats terse follow-up feedback as implementation by default', () => {
    expect(expectsFileOutput('blue instead', true)).toBe(true);
    expect(expectsFileOutput('more playful and less cramped', true)).toBe(true);
    expect(expectsFileOutput("I don't like the header", true)).toBe(true);
  });

  it('does not force file output for clear questions or pleasantries', () => {
    expect(expectsFileOutput('Why did you choose that color?', true)).toBe(false);
    expect(expectsFileOutput('What files are in this app?', true)).toBe(false);
    expect(expectsFileOutput('Thanks!', true)).toBe(false);
    expect(expectsFileOutput('', true)).toBe(false);
  });
});

describe('resolveAssistantText', () => {
  it('never displays a success claim when an expected edit produced no files', () => {
    expect(resolveAssistantText('Done, I changed it.', 0, true)).toBe(
      "That model still didn't send savable code blocks, so I didn't change your app. Try again, or switch models for this turn.",
    );
  });

  it('preserves model text for successful edits and informational replies', () => {
    expect(resolveAssistantText('Updated the card.', 2, true)).toBe('Updated the card.');
    expect(resolveAssistantText('CSS grid fits this layout.', 0, false)).toBe('CSS grid fits this layout.');
  });
});
