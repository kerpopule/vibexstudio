import type { ChatMessage } from '@/lib/types';

/** Old media messages stored their mode only in the display prefix. */
export function retryRequest(message: ChatMessage): NonNullable<ChatMessage['request']> {
  if (message.request) return message.request;
  const legacy = /^Generate (image|video): ([\s\S]*)$/.exec(message.text);
  if (legacy) return { mode: legacy[1] as 'image' | 'video', prompt: legacy[2] };
  return { mode: 'chat', prompt: message.text };
}
