/**
 * One "vibe turn": send the conversation + current files to the model,
 * stream the reply, write any returned files to the project, and persist the
 * chat. This is the heart of the app.
 */
import { streamChat, type WireMessage } from '@/lib/ai/chat';
import { parseAssistantReply } from '@/lib/ai/parser';
import { buildSystemPrompt } from '@/lib/ai/prompts';
import { expectsFileOutput, resolveAssistantText } from '@/lib/ai/turn-intent';
import { getMediaLabPromptContext, handleMediaRequests } from '@/lib/medialab-tool';
import { listFiles, newId, readChat, writeChat, writeFile } from '@/lib/storage/projects';
import type { ChatMessage, ProjectMeta, ProviderConnection } from '@/lib/types';

/** Keep prompts bounded: only the most recent turns ride along. */
const MAX_HISTORY_MESSAGES = 20;

// Some coding models (MiniMax M3 was the repro) will say they built/changed
// the app but omit the `file=` fences on the first pass. That makes the chat
// look successful while nothing actually changes. For build/edit-shaped turns,
// give the model exactly one immediate correction before we finalize the
// assistant message.
const FILELESS_BUILD_RETRY = `Your last reply did not include any savable VibeX file blocks, so nothing changed.

Output the COMPLETE file contents now using ONLY fenced blocks with file= paths, like:

\`\`\`html file=index.html
<!doctype html>
...
\`\`\`

If this is an edit, output the complete content of every touched file. Do not summarize. Do not say you did it unless you output file blocks.`;

export interface VibeTurnCallbacks {
  /** Live streaming text (raw, may contain partial file blocks). */
  onStream: (partial: string) => void;
  /** Chat list changed (user msg added, assistant msg finalized). */
  onMessages: (messages: ChatMessage[]) => void;
  /** Files were written; preview should reload. */
  onFilesChanged: (paths: string[]) => void;
}

export async function runVibeTurn(opts: {
  project: ProjectMeta;
  userText: string;
  connection: ProviderConnection;
  secret: string;
  model: string;
  callbacks: VibeTurnCallbacks;
  signal?: AbortSignal;
}): Promise<void> {
  const { project, userText, connection, secret, model, callbacks, signal } = opts;

  const history = await readChat(project.id);
  const userMessage: ChatMessage = { id: newId(), role: 'user', text: userText, createdAt: Date.now() };
  let messages = [...history, userMessage];
  await writeChat(project.id, messages);
  callbacks.onMessages(messages);

  const files = await listFiles(project.id);
  // Media protocol context: paired Media Lab + its castable characters (or
  // the images-only variant). Never blocks the turn on a sleeping server.
  const mediaLab = await getMediaLabPromptContext().catch(() => null);
  const system = buildSystemPrompt(project.name, files, project.designReference, mediaLab);
  const wire: WireMessage[] = messages
    .slice(-MAX_HISTORY_MESSAGES)
    .filter((m) => m.text.trim() !== '')
    .map((m) => ({ role: m.role, content: m.text }));

  let assistant: ChatMessage = { id: newId(), role: 'assistant', text: '', createdAt: Date.now() };
  try {
    let raw = await streamChat({
      connection,
      secret,
      model,
      system,
      messages: wire,
      signal,
      onDelta: callbacks.onStream,
    });

    const expectedFileOutput = expectsFileOutput(userText, files.length > 0);
    let parsed = parseAssistantReply(raw);
    // A media fence IS real output — never trigger the fileless retry over
    // a reply that requested media, even without code blocks.
    if (parsed.files.length === 0 && parsed.media.length === 0 && expectedFileOutput) {
      callbacks.onStream(`${raw}\n\n⚡ Tightening the build format…`);
      raw = await streamChat({
        connection,
        secret,
        model,
        system,
        messages: [
          ...wire,
          { role: 'assistant', content: raw },
          { role: 'user', content: FILELESS_BUILD_RETRY },
        ],
        signal,
        onDelta: callbacks.onStream,
      });
      parsed = parseAssistantReply(raw);
    }

    const written: string[] = [];
    for (const file of parsed.files) {
      await writeFile(project.id, file.path, file.content);
      written.push(file.path);
    }
    // Fire media submissions before finalizing the assistant message: server
    // jobs get queued + placeholders written, on-device images generate
    // inline. The outcome's status lines ride on the reply text and its
    // written placeholders count as real file output.
    let mediaStatus = '';
    if (parsed.media.length > 0) {
      callbacks.onStream(`${raw}\n\n🎬 Sending media to production…`);
      const media = await handleMediaRequests(project, parsed.media);
      written.push(...media.writtenPaths);
      mediaStatus = media.statusLines.join('\n');
    }
    const baseText = resolveAssistantText(parsed.text, written.length, expectedFileOutput);
    assistant = {
      ...assistant,
      text: mediaStatus ? `${baseText}\n\n${mediaStatus}` : baseText,
      filesWritten: written.length ? written : undefined,
      error:
        expectedFileOutput && written.length === 0
          ? 'no-file-blocks'
          : undefined,
    };
    if (written.length) callbacks.onFilesChanged(written);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      assistant = { ...assistant, text: 'Stopped.', error: 'aborted' };
    } else {
      const message = e instanceof Error ? e.message : String(e);
      assistant = { ...assistant, text: message, error: message };
    }
  }

  messages = [...messages, assistant];
  await writeChat(project.id, messages);
  callbacks.onMessages(messages);
}
