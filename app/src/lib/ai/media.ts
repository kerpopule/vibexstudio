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
import { acceptFalRequest,validateFalSongOptions,type FalSongOptions } from '@/lib/ai/fal-recovery';
import { falModelUrl, falQueueUrl, fetchFalQueue } from '@/lib/ai/fal-queue';
import { recommendedFalModel } from '@/lib/ai/fal-catalog';
import { PROVIDERS } from '@/lib/ai/registry';
import { extractApiError } from '@/lib/ai/sse';
import { SUBSCRIPTION_PROVIDERS } from '@/lib/ai/subscriptionOauth';
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
  // xAI subscription logins (SuperGrok / X Premium+) reach the same
  // /images/generations endpoint their API keys do.
  if (connection.subscription) return connection.subscription === 'xai-oauth';
  return PROVIDERS[connection.kind].capabilities.image;
}

export function canGenerateVideo(connection: ProviderConnection): boolean {
  if (connection.subscription) return false;
  return PROVIDERS[connection.kind].capabilities.video;
}

export async function generateImage(
  connection: ProviderConnection,
  secret: string,
  prompt: string,
  recoveryId?: string,
  recoveryProjectId?: string
): Promise<GeneratedImage> {
  if (connection.subscription === 'xai-oauth') {
    const baseUrl = connection.baseUrl || SUBSCRIPTION_PROVIDERS['xai-oauth'].inferenceBaseUrl;
    return openAiStyleImage(baseUrl, secret, prompt, XAI_IMAGE_MODEL);
  }
  const baseUrl = connection.baseUrl || PROVIDERS[connection.kind].baseUrl;
  switch (connection.kind) {
    case 'gemini':
      return geminiImage(connection, secret, prompt);
    case 'xai':
      return openAiStyleImage(baseUrl, secret, prompt, XAI_IMAGE_MODEL);
    case 'openai':
      return openAiStyleImage(baseUrl, secret, prompt, OPENAI_IMAGE_MODEL);
    case 'fal':
      return falImage(connection, secret, prompt, recoveryId, recoveryProjectId);
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
  rawBaseUrl: string,
  secret: string,
  prompt: string,
  model: string
): Promise<GeneratedImage> {
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');
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
  onProgress?: (detail: string) => void,
  recoveryId?: string,
  recoveryProjectId?: string
): Promise<GeneratedVideo> {
  if (connection.kind === 'fal') return falVideo(connection, secret, prompt, onProgress, recoveryId, recoveryProjectId);
  if (connection.kind !== 'gemini') {
    throw new Error('Video generation needs Google Gemini (Veo) or a fal.ai connection.');
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

// ---------------------------------------------------------------------------
// fal.ai (queue REST): POST https://queue.fal.run/{model} with
// `Authorization: Key <key>`, poll the returned status_url until COMPLETED,
// then fetch response_url for the result payload.
// ---------------------------------------------------------------------------

async function falImage(
  connection: ProviderConnection,
  secret: string,
  prompt: string,
  recoveryId?: string,
  recoveryProjectId?: string
): Promise<GeneratedImage> {
  const model = connection.mediaModels?.image || recommendedFalModel('image');
  const result = await falQueueRun(model, secret, prompt, undefined, 4 * 60 * 1000, recoveryId ? {id:recoveryId,providerId:connection.id,providerLabel:connection.label,kind:'image',projectId:recoveryProjectId} : undefined);
  const image = result?.images?.[0];
  if (!image?.url) throw new Error('fal.ai returned no image. Try rephrasing the prompt.');
  return { base64: await fetchAsBase64(image.url), mimeType: image.content_type ?? 'image/png' };
}

async function falVideo(
  connection: ProviderConnection,
  secret: string,
  prompt: string,
  onProgress?: (detail: string) => void,
  recoveryId?: string,
  recoveryProjectId?: string
): Promise<GeneratedVideo> {
  const model = connection.mediaModels?.video || recommendedFalModel('video');
  onProgress?.('Starting video generation…');
  const result = await falQueueRun(
    model,
    secret,
    prompt,
    () => onProgress?.('Rendering video… this can take a couple of minutes.'),
    8 * 60 * 1000,
    recoveryId ? {id:recoveryId,providerId:connection.id,providerLabel:connection.label,kind:'video',projectId:recoveryProjectId} : undefined
  );
  const url: string | undefined = result?.video?.url;
  if (!url) throw new Error('fal.ai finished but returned no video.');
  return { url, mimeType: result?.video?.content_type ?? 'video/mp4' };
}

export const FAL_SONG_MODEL = 'fal-ai/ace-step/prompt-to-audio';

/** Direct BYO-key audio uses the same durable queue boundary as image/video.
 * The caller must retain the request ID until the local output is saved. */
export async function generateFalSong(connection:ProviderConnection,secret:string,prompt:string,requestId:string,songOptions?:FalSongOptions):Promise<{url:string;mimeType:string}>{
  if(connection.kind!=='fal'||connection.auth!=='apiKey')throw new Error('Choose a fal.ai API-key connection to make a song.');
  const text=prompt.trim();
  if(!text||text.length>8000)throw new Error('Describe your song in 1–8,000 characters.');
  if(!requestId)throw new Error('A saved request identity is required before making a song.');
  if(songOptions!==undefined)songOptions=validateFalSongOptions(songOptions);
  const result=await falQueueRun(FAL_SONG_MODEL,secret,text,undefined,8*60*1000,
    {id:requestId,providerId:connection.id,providerLabel:connection.label,kind:'audio',songOptions});
  const raw=result?.audio?.url;
  let url:URL;
  try{url=new URL(raw);}catch{throw new Error('fal.ai finished but returned no readable audio URL.');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('fal.ai returned an unsupported audio URL.');
  const type=result.audio.content_type??'audio/wav';
  const mimeType=type==='audio/x-wav'?'audio/wav':type;
  if(!['audio/wav','audio/mpeg','audio/flac','audio/ogg','audio/mp4'].includes(mimeType))throw new Error('fal.ai returned an unsupported audio format.');
  return {url:url.href,mimeType};
}

/** Submits a fal queue job and polls it to completion; returns the payload. */
async function falQueueRun(
  model: string,
  secret: string,
  prompt: string,
  onPoll: (() => void) | undefined,
  timeoutMs: number,
  recovery?: {id:string;providerId:string;providerLabel:string;projectId?:string;songOptions?:FalSongOptions;kind:'image'|'video'|'audio'}
): Promise<any> {
  let statusUrl:string,responseUrl:string;
  if(recovery){
    ({statusUrl,responseUrl}=await acceptFalRequest({...recovery,model,prompt},secret));
  }else{
    const submitRes = await fetchFalQueue(falModelUrl(model), secret, {prompt});
    const submitText = await submitRes.text();
    if (!submitRes.ok) throw new Error(extractApiError(submitText, submitRes.status));
    const submitted = JSON.parse(submitText);
    statusUrl = falQueueUrl(submitted?.status_url);
    responseUrl = falQueueUrl(submitted?.response_url);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    onPoll?.();
    const pollRes = await fetchFalQueue(statusUrl, secret);
    const pollText = await pollRes.text();
    if (!pollRes.ok) throw new Error(extractApiError(pollText, pollRes.status));
    const status = JSON.parse(pollText)?.status;
    if (status === 'COMPLETED') {
      const res = await fetchFalQueue(responseUrl, secret);
      const text = await res.text();
      if (!res.ok) throw new Error(extractApiError(text, res.status));
      return JSON.parse(text);
    }
    // IN_QUEUE / IN_PROGRESS keep polling; anything else is a failure.
    if (status !== 'IN_QUEUE' && status !== 'IN_PROGRESS') {
      throw new Error(`fal.ai could not finish the job (status: ${status ?? 'unknown'}).`);
    }
  }
  throw new Error('This fal.ai job is taking longer than expected and may still be running. Check your fal.ai queue before starting another generation.');
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
