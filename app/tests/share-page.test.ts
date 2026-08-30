import { describe, expect, it } from 'vitest';

import { buildImportDeepLink, renderSharePage } from '@/lib/github/sharePage';

describe('buildImportDeepLink', () => {
  it('builds the vibex:// import link', () => {
    expect(buildImportDeepLink('octocat', 'my-app', 'main')).toBe(
      'vibex://import?repo=octocat%2Fmy-app&ref=main'
    );
  });
});

describe('renderSharePage', () => {
  const html = renderSharePage({
    owner: 'octocat',
    repo: 'my-app',
    branch: 'main',
    appName: 'My <Cool> App',
    appEmoji: '🎮',
  });

  it('escapes the app name', () => {
    expect(html).toContain('My &lt;Cool&gt; App');
    expect(html).not.toContain('My <Cool> App');
  });

  it('links the deep link, web url, and both stores', () => {
    expect(html).toContain('vibex://import?repo=octocat%2Fmy-app&ref=main');
    expect(html).toContain('https://octocat.github.io/my-app/');
    expect(html).toContain('https://apps.apple.com/app/vibexstudio/id6779501769');
    expect(html).toContain('play.google.com');
  });
});
