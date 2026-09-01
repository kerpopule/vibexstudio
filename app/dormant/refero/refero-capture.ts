import type { ReferoRenderedCapture } from './references';
import { isEligibleReferoStyleUrl } from './references';

export const REFERO_CAPTURE_PROTOCOL_VERSION = 1 as const;
export const MAX_REFERO_CAPTURE_MESSAGE_CHARS = 20_000;
export const MAX_REFERO_CAPTURE_DESIGN_TEXT_CHARS = 12_000;
const MAX_CAPTURE_TITLE_CHARS = 500;
const MAX_CAPTURE_PREVIEW_URL_CHARS = 2_048;
const MAX_CAPTURE_TOKEN_CHARS = 128;
const CAPTURE_TOKEN = /^[A-Za-z0-9_-]+$/;

export interface PendingReferoCapture {
  requestId: string;
  nonce: string;
  pageUrl: string;
}

export interface ReferoCaptureMessage {
  version: typeof REFERO_CAPTURE_PROTOCOL_VERSION;
  kind: 'refero-style-capture';
  requestId: string;
  nonce: string;
  pageUrl: string;
  canonicalUrl: string;
  payload: ReferoRenderedCapture;
}

export type ReferoCaptureRejectionReason =
  | 'no-active-request'
  | 'navigation-mismatch'
  | 'message-too-large'
  | 'invalid-message'
  | 'request-mismatch';

export type ReferoCaptureResult =
  | { ok: true; pending: null; message: ReferoCaptureMessage }
  | { ok: false; pending: PendingReferoCapture | null; reason: ReferoCaptureRejectionReason };

export function createPendingReferoCapture(
  pageUrl: string,
  requestId: string,
  nonce: string
): PendingReferoCapture {
  if (!isEligibleReferoStyleUrl(pageUrl)) {
    throw new Error('A Refero capture requires the exact visible canonical style URL.');
  }
  if (!isCaptureToken(requestId) || !isCaptureToken(nonce)) {
    throw new Error('Invalid Refero capture receipt.');
  }
  return { requestId, nonce, pageUrl };
}

/**
 * Validate a WebView response against the one active native request. Rejections
 * preserve the pending request; only a fully matched response consumes it.
 */
export function consumeReferoCaptureMessage(
  pending: PendingReferoCapture | null,
  currentUrl: string,
  rawMessage: string
): ReferoCaptureResult {
  if (!pending) return { ok: false, pending, reason: 'no-active-request' };
  if (currentUrl !== pending.pageUrl) {
    return { ok: false, pending, reason: 'navigation-mismatch' };
  }
  if (rawMessage.length > MAX_REFERO_CAPTURE_MESSAGE_CHARS) {
    return { ok: false, pending, reason: 'message-too-large' };
  }

  const message = parseReferoCaptureMessage(rawMessage);
  if (!message) return { ok: false, pending, reason: 'invalid-message' };
  if (
    message.requestId !== pending.requestId ||
    message.nonce !== pending.nonce ||
    message.pageUrl !== pending.pageUrl ||
    message.canonicalUrl !== pending.pageUrl
  ) {
    return { ok: false, pending, reason: 'request-mismatch' };
  }

  return { ok: true, pending: null, message };
}

export function buildReferoCaptureScript(pending: PendingReferoCapture): string {
  const request = JSON.stringify(pending);
  const protocolVersion = JSON.stringify(REFERO_CAPTURE_PROTOCOL_VERSION);
  const maxDesignTextChars = JSON.stringify(MAX_REFERO_CAPTURE_DESIGN_TEXT_CHARS);
  const maxTitleChars = JSON.stringify(MAX_CAPTURE_TITLE_CHARS);
  const maxPreviewUrlChars = JSON.stringify(MAX_CAPTURE_PREVIEW_URL_CHARS);

  return `
(() => {
  const request = ${request};
  const visible = (element) => {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  };
  const visibleText = (element) => visible(element) ? String(element.innerText || '').trim() : '';
  const explicitSelector = '[data-design-md], [data-design-system], [data-style-description]';
  const descendantSelector = 'pre, code, [data-design-text]';
  const explicitContainers = Array.from(document.querySelectorAll(explicitSelector)).filter(visible);
  const knownSectionLabels = new Set(['Color Palette', 'Typography', 'Spacing & Shape', 'Guidelines']);
  const labelledContainers = Array.from(document.querySelectorAll('h1, h2, h3, h4, [role="heading"]'))
    .filter((heading) => {
      if (!visible(heading)) return false;
      const label = visibleText(heading);
      return knownSectionLabels.has(label) || /DESIGN\\.md|style guide|design system|visual language/i.test(label);
    })
    .map((heading) => heading.closest('[data-design-section], section') || heading.parentElement)
    .filter(Boolean);
  const containers = Array.from(new Set([...explicitContainers, ...labelledContainers])).slice(0, 8);
  const designParts = [];
  for (const container of containers) {
    const descendants = Array.from(container.querySelectorAll(descendantSelector)).filter(visible).slice(0, 8);
    const parts = descendants.length ? descendants.map(visibleText).filter(Boolean) : [visibleText(container)].filter(Boolean);
    designParts.push(...parts);
    if (designParts.join('\\n').length >= ${maxDesignTextChars}) break;
  }
  const title = (visibleText(document.querySelector('h1')) || document.title || 'Refero style').slice(0, ${maxTitleChars});
  const previewImageUrl = String(
    document.querySelector('meta[property="og:image"]')?.content ||
    document.querySelector('meta[name="twitter:image"]')?.content ||
    document.querySelector('main img')?.src ||
    ''
  ).slice(0, ${maxPreviewUrlChars});
  const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href || location.href;
  window.ReactNativeWebView?.postMessage(JSON.stringify({
    version: ${protocolVersion},
    kind: 'refero-style-capture',
    requestId: request.requestId,
    nonce: request.nonce,
    pageUrl: location.href,
    canonicalUrl,
    payload: {
      title,
      previewImageUrl,
      designText: designParts.join('\\n').slice(0, ${maxDesignTextChars}),
    },
  }));
})(); true;
`;
}

function parseReferoCaptureMessage(rawMessage: string): ReferoCaptureMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(rawMessage);
  } catch {
    return null;
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ['version', 'kind', 'requestId', 'nonce', 'pageUrl', 'canonicalUrl', 'payload'])) {
    return null;
  }
  if (value.version !== REFERO_CAPTURE_PROTOCOL_VERSION || value.kind !== 'refero-style-capture') return null;
  if (!isCaptureToken(value.requestId) || !isCaptureToken(value.nonce)) return null;
  if (typeof value.pageUrl !== 'string' || typeof value.canonicalUrl !== 'string') return null;
  if (!isEligibleReferoStyleUrl(value.pageUrl) || !isEligibleReferoStyleUrl(value.canonicalUrl)) return null;
  if (!isRecord(value.payload) || !hasOnlyKeys(value.payload, ['title', 'previewImageUrl', 'designText'])) return null;

  const { title, previewImageUrl, designText } = value.payload;
  if (title !== undefined && (typeof title !== 'string' || title.length > MAX_CAPTURE_TITLE_CHARS)) return null;
  if (
    previewImageUrl !== undefined &&
    (typeof previewImageUrl !== 'string' || previewImageUrl.length > MAX_CAPTURE_PREVIEW_URL_CHARS)
  ) {
    return null;
  }
  if (
    designText !== undefined &&
    (typeof designText !== 'string' || designText.length > MAX_REFERO_CAPTURE_DESIGN_TEXT_CHARS)
  ) {
    return null;
  }

  return value as unknown as ReferoCaptureMessage;
}

function isCaptureToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CAPTURE_TOKEN_CHARS &&
    CAPTURE_TOKEN.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
