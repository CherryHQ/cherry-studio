# Agent runtime

Runs the Pi coding agent (`@earendil-works/pi-coding-agent`) with every model request made by the
host through the AI SDK. Pi owns the agent loop: tool execution, steering, compaction. The host owns
the model call, so Cherry's AI SDK plugin chain (`transformParams`, model middlewares, usage
accounting, retries) applies to Pi's requests unchanged.

**Status:** not wired into the app. Nothing in `src/` imports this package yet.

## Boundaries

- No imports from the app (`src/`, `@main`, `@shared`, `@logger`, `@application`, `@data`) and no
  logging. Everything host-specific comes in through the options below.
- Pi is ESM-only and the main bundle is CommonJS, so the host must load this package with a dynamic
  `import()`, as `src/main/ai/runtime/pi/piSdk.ts` does for Pi itself.
- External code enters through the package export only (`src/index.ts`).

## How a model request flows

1. Pi calls the provider's `streamSimple` once per model request (agent turns and compaction
   summaries alike).
2. `createAiSdkProvider` converts Pi's transcript into AI SDK `ModelMessage[]` (after Pi's own
   `transformMessages` replay rules), Pi's tools into AI SDK tools **without** `execute`, and calls
   the host's `ModelCallPort.streamText(request)`.
3. The host runs one single-step `streamText` (in Cherry: ai-core's executor). With no `execute`,
   the AI SDK returns tool calls instead of running them, and Pi stays the loop owner.
4. The bridge maps `fullStream` back into Pi events: text, reasoning (provider metadata is kept in Pi's
   signature slots via `encodeProviderMetadata`), tool calls, usage, stop reason, errors and abort.

## Host-facing contracts

- **`ModelCallPort`** – the only way out to a model. The request carries a `requestId`, Pi's
  `sessionId`, and `options`, the host's own per-request settings.
- **Reasoning** – the host decides it through `requestOptions` (forwarded verbatim on every request),
  never through Pi's thinking level, which lacks Cherry levels such as `ultra`.
- **Side channel** – `onError` receives the original error object (for example `APICallError` with
  `statusCode` and `responseBody`), and `onUnmappedPart` receives `source`, `file` and
  provider-executed tool parts. Both get the request identity. Pi keeps only the error message, as
  the provider wrote it, so Pi's context-overflow detection still works.
- **Usage** – the usage handed to Pi feeds its context accounting and compaction only. The host's AI SDK
  call already accounts it, so it must not be billed again.
- **Retries** – Pi's retry is always disabled. Retries belong to the AI SDK layer.
- **Model identity** – Pi replays reasoning signatures only when an assistant message's provider,
  api (`AI_SDK_API`) and model id match the current model. Register a model with ids that stay the
  same for one host model across sessions, and use them when rebuilding history.

## Session builder

`createAgentRuntimeSession` builds an `AgentSession` entirely in memory: in-memory credentials,
models and settings, `SessionManager.inMemory` seeded with the host's Pi `Message[]` history,
and a `DefaultResourceLoader` with extensions, skills, prompt templates, themes and context files
off. The host supplies the system prompt (Pi still appends a `<cwd>` section), custom tools, the
enabled built-in tools (none by default), extra extension factories, the model descriptor and Pi
settings such as compaction. `dispose()` aborts the running turn, emits `session_shutdown` to
extensions and disposes the session.

## Known gaps

- A single tool result larger than the context window survives compaction (it is the kept recent
  turn), so the next request is rejected as context overflow and the turn ends without an answer.
  Truncating oversized results is the next step.
- Pi's `after_provider_response` extension event never fires for these models: `streamText` does not
  expose response headers before the body is consumed.
- Tool call ids from another provider are replayed as-is (no `normalizeToolCallId`). A provider
  with stricter id rules may reject history recorded by a different one.
- Pi's resource loader still scans its discovery directories (`cwd/.pi`, `agentDir`,
  `~/.agents/skills`) while loading. The `no*` flags and prompt overrides discard everything it finds.

## Tests

```bash
pnpm test:agent-runtime                              # from the repository root
pnpm --filter @cherrystudio/agent-runtime test       # or the package's own Vitest config
pnpm --filter @cherrystudio/agent-runtime typecheck
```

Tests drive real `streamText` over `MockLanguageModelV3` (and one real provider over local HTTP)
through the same port shape the host implements.
