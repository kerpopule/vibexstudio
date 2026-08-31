# Agentic web access — the `web` fence protocol

Lets the coding model search the web and read pages for context before it
builds, so "make it look like stripe.com" or "use the current API" works
without the user pasting docs. Same text-fence pattern as the `medialab`
protocol (docs/AGENT-MEDIA.md): text-only, so it works on every provider,
subscriptions included.

## The protocol

Two fences the model may emit; the body is optional and ignored — the whole
request lives in the info string:

````
```web search=<query>
```

```web url=<https url>
```
````

- `search=` — everything after the `=` to the end of the info line is the
  query. Trimmed, surrounding quotes stripped, max 200 chars.
- `url=` — must be a full `https://` URL. `http://` and every other scheme
  are rejected; the fence then stays in the visible text, never
  half-executed (exactly like a malformed `medialab` fence).
- Multiple fences per reply are allowed (only the first 4 per round run).
  Duplicate requests are de-duped.

## The loop (bounded, inside `runVibeTurn`)

`src/lib/vibe.ts` runs the turn as before, then:

1. Parse `web` fences from the reply (`src/lib/ai/parser.ts` →
   `parseWebFence` in `src/lib/ai/web-tools-core.ts`, both pure + tested).
2. If any requests remain in budget, execute them
   (`src/lib/ai/web-tools.ts`) and run a **continuation**: the assistant's
   raw reply plus a user-role message carrying the results
   (`[web results]\n### <url or query>\n<content>…`) are appended to the
   wire conversation, and another completion streams.
3. Repeat until the reply has no executable web fences or the budget is
   spent. The **last** reply's parsed text/files become the chat message and
   the written project files — intermediate research replies never become
   chat messages. Research activity streams to the build card via
   `callbacks.onStream` ("🔎 Searching: …", "📄 Reading <host>…" lines
   prefixed above the live stream).

The fileless-build retry still applies to the final reply, and it keeps the
research conversation so the correction pass retains what was learned.

### Budgets (all in `web-tools-core.ts`)

| Limit | Value |
| --- | --- |
| Requests per round | 4 |
| Requests per user turn | 8 |
| Research rounds per user turn | 2 |
| Extracted text per fetched page | 6,000 chars (`…[truncated]`) |
| Search results per query | top 5 |
| Injected tool text per round | 20,000 chars |

When the round being executed exhausts the budget, the results message ends
with an explicit "produce your final reply now with complete file= blocks"
instruction; the system prompt teaches the same discipline (research first
round, build second).

## Execution (`src/lib/ai/web-tools.ts`)

- **search** — GET `https://html.duckduckgo.com/html/?q=<enc>` with a
  desktop-browser UA. Results parsed from `result__a` anchors (whose hrefs
  are `//duckduckgo.com/l/?uddg=<encoded real url>` redirects — the `uddg`
  param is decoded back to the destination) plus `result__snippet` text;
  the top 5 return as `title — url\nsnippet`.
- **url** — GET with a 10s timeout. Only `text/html` and `text/plain`
  responses are read (anything else returns a short "skipped" note);
  HTML is reduced to text (scripts/styles/tags stripped, entities decoded,
  whitespace collapsed) and capped.
- **Failures** — every failure becomes a short inline note in the results
  ("could not fetch X: timeout"); research never throws out of the turn.
- **Abort** — the turn's `AbortSignal` is threaded into every fetch, so
  Stop works mid-research and finalizes the message as "Stopped.".

Pure logic (fence parsing, DDG parsing, html→text, budgets, results-message
building) lives in `src/lib/ai/web-tools-core.ts` and is unit-tested
(`tests/web-tools-core.test.ts`); the effectful side (fetches, timeouts,
UA headers) is `web-tools.ts`.

## Prompt contract (`src/lib/ai/prompts.ts`)

The system prompt documents the fence, when to use it (user references a
site/library/API, needs current info, wants to match a site), and the
discipline: research-only first reply, build after results, never fetch
non-https, never cite anything that wasn't actually fetched.
