export const referoWebViewMediaProps = {
  allowsInlineMediaPlayback: true,
  allowsFullscreenVideo: false,
  mediaPlaybackRequiresUserAction: true,
} as const;

/**
 * Refero is a browsing surface, not a media feed. This policy is video-only:
 * it does not intercept page touch/scroll events or modify images/GIFs.
 */
export const REFERO_MEDIA_POLICY_SCRIPT = `
(() => {
  if (window.__vibexReferoMediaPolicy) return true;
  window.__vibexReferoMediaPolicy = true;

  const MAX_VIDEOS_PER_BATCH = 200;
  const MAX_MUTATIONS_PER_BATCH = 200;
  const noFullscreen = () => Promise.resolve();
  const noNativeFullscreen = () => undefined;

  const installFullscreenGuards = () => {
    const elementPrototype = window.Element && Element.prototype;
    const videoPrototype = window.HTMLVideoElement && HTMLVideoElement.prototype;
    for (const name of ['requestFullscreen', 'webkitRequestFullscreen']) {
      if (!elementPrototype || !(name in elementPrototype)) continue;
      try {
        Object.defineProperty(elementPrototype, name, { configurable: true, writable: true, value: noFullscreen });
      } catch {}
    }
    if (videoPrototype && 'webkitEnterFullscreen' in videoPrototype) {
      try {
        Object.defineProperty(videoPrototype, 'webkitEnterFullscreen', {
          configurable: true,
          writable: true,
          value: noNativeFullscreen,
        });
      } catch {}
    }
  };

  const normalizeVideo = (video) => {
    if (!(video instanceof HTMLVideoElement)) return;
    video.removeAttribute('autoplay');
    video.autoplay = false;
    if (!video.hasAttribute('playsinline')) video.setAttribute('playsinline', '');
    if (!video.hasAttribute('webkit-playsinline')) video.setAttribute('webkit-playsinline', '');
    video.playsInline = true;
    if (video.getAttribute('controlsList') !== 'nofullscreen') video.setAttribute('controlsList', 'nofullscreen');
    video.disablePictureInPicture = true;
    video.defaultMuted = true;
    video.muted = true;
    video.pause();
  };

  const normalize = (root) => {
    const videos = root instanceof HTMLVideoElement
      ? [root]
      : Array.from(root.querySelectorAll?.('video') || []);
    for (let start = 0; start < videos.length; start += MAX_VIDEOS_PER_BATCH) {
      const batch = videos.slice(start, start + MAX_VIDEOS_PER_BATCH);
      if (start === 0) batch.forEach(normalizeVideo);
      else queueMicrotask(() => batch.forEach(normalizeVideo));
    }
  };

  // Refero starts playback from script as cards scroll into view, which
  // sails past attribute stripping. Gate play() itself: it only works
  // within a second of a real touch on the page.
  let lastTouch = 0;
  const markTouch = () => { lastTouch = Date.now(); };
  document.addEventListener('touchend', markTouch, { capture: true, passive: true });
  document.addEventListener('click', markTouch, { capture: true, passive: true });
  const mediaPrototype = window.HTMLMediaElement && HTMLMediaElement.prototype;
  if (mediaPrototype && !mediaPrototype.__vibexPlayGate) {
    const nativePlay = mediaPrototype.play;
    try {
      Object.defineProperty(mediaPrototype, 'play', {
        configurable: true,
        writable: true,
        value: function gatedPlay() {
          if (Date.now() - lastTouch < 1000) return nativePlay.call(this);
          try { this.pause(); } catch {}
          return Promise.resolve();
        },
      });
      mediaPrototype.__vibexPlayGate = true;
    } catch {}
  }

  installFullscreenGuards();
  normalize(document);
  document.addEventListener('DOMContentLoaded', () => normalize(document), { once: true });

  new MutationObserver((records) => {
    const boundedRecords = records.slice(0, MAX_MUTATIONS_PER_BATCH);
    for (const record of boundedRecords) {
      if (record.type === 'attributes') normalizeVideo(record.target);
      for (const node of record.addedNodes) {
        if (node instanceof Element) normalize(node);
      }
    }
    if (records.length > boundedRecords.length) queueMicrotask(() => normalize(document));
  }).observe(document.documentElement || document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['autoplay', 'playsinline', 'webkit-playsinline', 'controlsList'],
  });

  true;
})();
`;
