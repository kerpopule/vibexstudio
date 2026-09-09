import { describe, expect, it } from 'vitest';
import { rewritePreviewAssets } from '@/lib/preview-assets';
const assets = new Map([['assets/win.webm', 'blob:win'], ['assets/sprite.png', 'blob:sprite']]);
describe('preview media resolution', () => {
  it('plays project media referenced by an external game script', () => {
    expect(rewritePreviewAssets("video.src = 'assets/win.webm';", 'scripts/game.js', assets)).toBe("video.src = 'blob:win';");
  });
  it('resolves stylesheet-relative background images', () => {
    expect(rewritePreviewAssets('.hero { background: url(../assets/sprite.png) }', 'css/game.css', assets)).toContain('url("blob:sprite")');
  });
  it('resolves HTML paths and keeps media fragments', () => {
    expect(rewritePreviewAssets('<video src="./assets/win.webm?v=1#t=2">', 'index.html', assets)).toBe('<video src="blob:win#t=2">');
  });
  it('preserves remote URLs, missing files, and dynamic template expressions', () => {
    const input = '"https://host/assets/sprite.png" "unknown.png" `assets/${name}.png`';
    expect(rewritePreviewAssets(input, 'index.html', assets)).toBe(input);
  });
  it('does not resolve traversal above the project', () => {
    expect(rewritePreviewAssets('"../assets/win.webm"', 'index.html', assets)).toBe('"../assets/win.webm"');
  });
});
