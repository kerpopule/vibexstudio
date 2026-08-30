/**
 * Image and video generation. Routed by provider:
 *  - Gemini: images via the image-out Gemini models, video via Veo
 *    (long-running operation, polled until done).
 *  - xAI (Grok): images via the OpenAI-compatible /images/generations.
 *  - OpenAI: images via /images/generations.
 *
 * Results are returned as base64 (images) or a downloadable URL (video) and
 * saved into the project's local media folder by the caller.
 */
import { PROVIDERS } from '@/lib/ai/registry';
import { extractApiError } from '@/lib/ai/sse';
import type { ProviderConnection } from '@/lib/types';

export const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
export const GEMINI_VIDEO_MODEL = 'veo-3.1-generate-preview';
export const XAI_IMAGE_MODEL = 'grok-2-image';
export const OPENAI_IMAGE_MODEL = 'gpt-image-1';

export interface GeneratedImage {
  base64: string;
  mimeType: string;
}

export function canGenerateImages(connection: ProviderConnection): boolean {
  return PROVIDERS[connection.kind].capabilities.image;
}

export function canGenerateVideo(connection: ProviderConnection): boolean {
  return PROVIDERS[connection.kind].capabilities.video;
}

export async function generateImage(
  connection: ProviderConnection,
  secret: string,
  prompt: string
): Promise<GeneratedImage> {
  switch (connection.kind) {
    case 'gemini':
      return geminiImage(connection, secret, prompt);
    case 'xai':
      return openAiStyleImage(connection, secret, prompt, XAI_IMAGE_MODEL);
    case 'openai':
      return openAiStyleImage(connection, secret, prompt, OPENAI_IMAGE_MODEL);
    default:
      throw new Error(`${PROVIDERS[connection.kind].name} can't generate images. Connect Gemini, OpenAI, or Grok.`);
  }
}

async function geminiImage(connection: ProviderConnection, secret: string, prompt: string): Promise<GeneratedImage> {
  const baseUrl = (connection.baseUrl || PROVIDERS.gemini.baseUrl).replace(/\/+$/, '');
  const res = await fetch(`${baseUrl}/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': secret },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(extractApiError(text, res.status));
  const data = JSON.parse(text);
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find((p) => p?.inlineData?.data);
  if (!inline) throw new Error('Gemini returned no image. Try rephrasing the prompt.');
  return { base64: inline.inlineData.data, mimeType: inline.inlineData.mimeType ?? 'image/png' };
}

async function openAiStyleImage(
  connection: ProviderConnection,
  secret: string,
  prompt: string,
  model: string
): Promise<GeneratedImage> {
  const baseUrl = (connection.baseUrl || PROVIDERS[connection.kind].baseUrl).replace(/\/+$/, '');
  const res = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ model, prompt, n: 1, response_format: 'b64_json' }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(extractApiError(text, res.status));
  const data = JSON.parse(text);
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    // Some providers only return URLs; fetch and re-encode.
    const url = data?.data?.[0]?.url;
    if (!url) throw new Error('The provider returned no image data.');
    return { base64: await fetchAsBase64(url), mimeType: 'image/png' };
  }
  return { base64: b64, mimeType: 'image/png' };
}

export interface GeneratedVideo {
  /** Direct download URL (already key-authenticated where required). */
  url: string;
  mimeType: string;
}

/**
 * Generates a video with Veo via the Gemini API. This is a long-running
 * operation; we poll until it finishes (typically 1–3 minutes).
 */
export async function generateVideo(
  connection: ProviderConnection,
  secret: string,
  prompt: string,
  onProgress?: (detail: string) => void
): Promise<GeneratedVideo> {
  if (connection.kind !== 'gemini') {
    throw new Error('Video generation needs a Google Gemini connection (Veo).');
  }
  const baseUrl = (connection.baseUrl || PROVIDERS.gemini.baseUrl).replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': secret };

  onProgress?.('Starting video generation…');
  const startRes = await fetch(`${baseUrl}/models/${GEMINI_VIDEO_MODEL}:predictLongRunning`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ instances: [{ prompt }] }),
  });
  const startText = await startRes.text();
  if (!startRes.ok) throw new Error(extractApiError(startText, startRes.status));
  const operationName = JSON.parse(startText)?.name;
  if (!operationName) throw new Error('Veo did not return an operation to poll.');

  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    onProgress?.('Rendering video… this can take a couple of minutes.');
    const pollRes = await fetch(`${baseUrl}/${operationName}`, { headers });
    const pollText = await pollRes.text();
    if (!pollRes.ok) throw new Error(extractApiError(pollText, pollRes.status));
    const op = JSON.parse(pollText);
    if (op.error) throw new Error(op.error.message ?? 'Video generation failed.');
    if (op.done) {
      const video =
        op.response?.generateVideoResponse?.generatedSamples?.[0]?.video ??
        op.response?.generatedVideos?.[0]?.video;
      const uri: string | undefined = video?.uri;
      if (!uri) throw new Error('Veo finished but returned no video.');
      const sep = uri.includes('?') ? '&' : '?';
      return { url: `${uri}${sep}key=${encodeURIComponent(secret)}`, mimeType: 'video/mp4' };
    }
  }
  throw new Error('Video generation timed out. Try a shorter prompt.');
}

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the generated image (${res.status}).`);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return globalThis.btoa(binary);
}
