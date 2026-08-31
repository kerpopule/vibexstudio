import { describe, expect, it } from 'vitest';

import { REFERO_MEDIA_POLICY_SCRIPT, referoWebViewMediaProps } from '@/lib/design/refero-media-policy';

describe('Refero media policy', () => {
  it('normalizes current and dynamic videos without touching images or page scrolling', () => {
    expect(REFERO_MEDIA_POLICY_SCRIPT).toContain("removeAttribute('autoplay')");
    expect(REFERO_MEDIA_POLICY_SCRIPT).toContain("setAttribute('playsinline', '')");
    expect(REFERO_MEDIA_POLICY_SCRIPT).toContain("setAttribute('webkit-playsinline', '')");
    expect(REFERO_MEDIA_POLICY_SCRIPT).toContain('video.pause()');
    expect(REFERO_MEDIA_POLICY_SCRIPT).toContain('MutationObserver');
    expect(REFERO_MEDIA_POLICY_SCRIPT).toMatch(/MAX_VIDEOS_PER_BATCH\s*=\s*\d+/);
    expect(REFERO_MEDIA_POLICY_SCRIPT).not.toMatch(/querySelectorAll\?\.\('\s*(img|\*)/);
    expect(REFERO_MEDIA_POLICY_SCRIPT).not.toMatch(/preventDefault\(\)[\s\S]{0,80}(touchmove|scroll|wheel)/);
    expect(REFERO_MEDIA_POLICY_SCRIPT).not.toMatch(/\.play\s*\(/);
  });

  it('blocks DOM and native fullscreen paths while requiring gesture-only inline playback', () => {
    expect(REFERO_MEDIA_POLICY_SCRIPT).toContain("setAttribute('controlsList', 'nofullscreen')");
    expect(REFERO_MEDIA_POLICY_SCRIPT).toContain('requestFullscreen');
    expect(REFERO_MEDIA_POLICY_SCRIPT).toContain('webkitRequestFullscreen');
    expect(REFERO_MEDIA_POLICY_SCRIPT).toContain('webkitEnterFullscreen');
    expect(referoWebViewMediaProps).toEqual({
      allowsInlineMediaPlayback: true,
      allowsFullscreenVideo: false,
      mediaPlaybackRequiresUserAction: true,
    });
  });
});
