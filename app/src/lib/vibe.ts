/**
 * One "vibe turn": send the conversation + current files to the model,
 * stream the reply, write any returned files to the project, and persist the
 * chat. This is the heart of the app.
 */
import { streamChat, type WireMessage } from '@/lib/ai/chat';
import { parseAssistantReply } from '@/lib/ai/parser';
import { buildSystemPrompt } from '@/lib/ai/prompts';
import { expectsFileOutput, resolveAssistantText } from '@/lib/ai/turn-intent';
import { executeWebRequests } from '@/lib/ai/web-tools';
import { buildWebResultsMessage, EMPTY_WEB_BUDGET, planWebRound, type WebBudget } from '@/lib/ai/web-tools-core';
import { captureLibrarySnapshot, importLibraryRequests } from '@/lib/library-reuse';
import { getMediaLabPromptContext, handleMediaRequests } from '@/lib/medialab-tool';
import { listFiles, listProjectFilePaths, newId, readChat, writeChat, writeFile } from '@/lib/storage/projects';
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
  const userMessage: ChatMessage = { id: newId(), role: 'user', text: userText, request: { mode: 'chat', prompt: userText }, createdAt: Date.now() };
  let messages = [...history, userMessage];
  await writeChat(project.id, messages);
  callbacks.onMessages(messages);

  const files = await listFiles(project.id);
  // Media protocol context: paired Media Lab + its castable characters (or
  // the images-only variant). Never blocks the turn on a sleeping server.
  const [mediaLab, library] = await Promise.all([
    getMediaLabPromptContext().catch(() => null),
    captureLibrarySnapshot(userText).catch(() => ({offers:[],sources:new Map(),unavailable:['The library could not be read.']})),
  ]);
  const system = buildSystemPrompt(project.name, files, mediaLab, library);
  const wire: WireMessage[] = messages
    .slice(-MAX_HISTORY_MESSAGES)
    .filter((m) => m.text.trim() !== '')
    .map((m) => ({ role: m.role, content: m.text }));

  const written: string[] = [];
  let assistant: ChatMessage = { id: newId(), role: 'assistant', text: '', createdAt: Date.now() };
  try {
    // The agentic loop mutates a working copy of the wire conversation:
    // research replies + their results ride along as extra turns, but only
    // the LAST reply becomes the chat message (docs/AGENT-WEB.md).
    const conversation: WireMessage[] = [...wire];
    // Research activity lines shown above the live stream so the build card
    // keeps moving while the model reads the web.
    let progress = '';
    const onDelta = (partial: string) =>
      callbacks.onStream(progress ? `${progress}\n\n${partial}` : partial);

    let raw = await streamChat({
      connection,
      secret,
      model,
      system,
      messages: conversation,
      signal,
      onDelta,
    });

    const expectedFileOutput = expectsFileOutput(userText, files.length > 0);
    let parsed = parseAssistantReply(raw);

    // Bounded web-research loop: execute the reply's ```web fences, feed the
    // results back, and stream a continuation. Budgets in web-tools-core cap
    // rounds and requests; when they run out, the reply stands as-is.
    let webBudget: WebBudget = EMPTY_WEB_BUDGET;
    for (;;) {
      const round = planWebRound(parsed.web, webBudget);
      if (!round) break;
      webBudget = round.next;
      const results = await executeWebRequests(round.execute, {
        signal,
        onProgress: (label) => {
          progress = progress ? `${progress}\n${label}` : label;
          callbacks.onStream(progress);
        },
      });
      conversation.push({ role: 'assistant', content: raw });
      conversation.push({ role: 'user', content: buildWebResultsMessage(results, round.exhausted) });
      raw = await streamChat({
        connection,
        secret,
        model,
        system,
        messages: conversation,
        signal,
        onDelta,
      });
      parsed = parseAssistantReply(raw);
    }
    // A media fence IS real output — never trigger the fileless retry over
    // a reply that requested media, even without code blocks.
    if (parsed.files.length === 0 && parsed.media.length === 0 && parsed.assets.length === 0 && expectedFileOutput) {
      onDelta(`${raw}\n\n⚡ Tightening the build format…`);
      raw = await streamChat({
        connection,
        secret,
        model,
        system,
        messages: [
          ...conversation,
          { role: 'assistant', content: raw },
          { role: 'user', content: FILELESS_BUILD_RETRY },
        ],
        signal,
        onDelta,
      });
      parsed = parseAssistantReply(raw);
    }

    let libraryStatus = '';
    if (parsed.assets.length) {
      callbacks.onStream(`${raw}\n\nCopying your library creations into the project…`);
      const result = await importLibraryRequests(project.id, parsed.assets, library,
        [...await listProjectFilePaths(project.id), ...parsed.files.map((f)=>f.path), ...parsed.media.map((m)=>m.file)], signal);
      written.push(...result.written);
      libraryStatus = result.written.map((path)=>`Imported library creation → ${path}`).join('\n');
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      if (result.errors.length) throw new Error(result.errors.join('\n'));
    }
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    for (const file of parsed.files) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      await writeFile(project.id, file.path, file.content);
      written.push(file.path);
    }
    // Fire media submissions before finalizing the assistant message: server
    // jobs get queued + placeholders written, provider images generate
    // inline. The outcome's status lines ride on the reply text and its
    // written placeholders count as real file output.
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
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
      text: [baseText, libraryStatus, mediaStatus].filter(Boolean).join('\n\n'),
      filesWritten: written.length ? written : undefined,
      error:
        expectedFileOutput && written.length === 0
          ? 'no-file-blocks'
          : undefined,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      assistant = { ...assistant, text: written.length
        ? 'Stopped. Files already saved are listed below; review them in Files before continuing.'
        : 'Stopped.', error: 'aborted' };
    } else {
      const message = e instanceof Error ? e.message : String(e);
      assistant = { ...assistant, text: message, error: message };
    }
  }

  if (written.length) {
    assistant.filesWritten = written;
    callbacks.onFilesChanged(written);
  }
  messages = [...messages, assistant];
  await writeChat(project.id, messages);
  callbacks.onMessages(messages);
}
