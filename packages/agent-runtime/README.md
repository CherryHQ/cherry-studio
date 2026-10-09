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
- **Model identity** – every model has a host `key` (in Cherry, the unique model id). Assistant
  entries store it, and on rebuild only replies with the current key replay their reasoning and
  signatures; the Pi `provider`/`id` may change between sessions.

## Session builder

`createAgentRuntimeSession` builds an `AgentSession` entirely in memory: in-memory credentials,
models and settings, `SessionManager.inMemory` rebuilt from the host's transcript, and a
`DefaultResourceLoader` with extension, skill, prompt-template and theme discovery off. The host
supplies the system prompt (Pi's own prompt when omitted; Pi still appends a `<cwd>` section) and any
appended prompt, custom tools, the enabled built-in tools (none by default), extra extension
factories, the model descriptor and Pi settings such as compaction or `shellCommandPrefix`. It may
opt in to workspace `AGENTS.md` / `CLAUDE.md` context files and to explicit skill directories, as
Cherry's current Pi runtime does. `dispose()` aborts the running turn, emits `session_shutdown` to
extensions and disposes the session.

## Transcript

The host owns storage. It passes the session's transcript in (`transcript`, the full active path,
oldest first, uncompacted) and persists what comes out (`onEvent`). A session is always rebuilt from
the transcript; nothing is kept between sessions except `sessionId`, which should stay stable per
host session because it is also the prompt-cache routing key.

`TranscriptEntry` is plain JSON:

| Kind | Holds | Pi entry |
| --- | --- | --- |
| `message` | AI SDK `ModelMessage` (`user`, `assistant`, `tool` with one `tool-result`), plus `modelKey`, `usage`, `stopReason`, `errorMessage`, `responseId` (assistant) and `details` (tool) | `message` |
| `message` with `custom` | a `user` message an extension added (`pi.sendMessage`), with its type, display flag and details | `custom_message` |
| `compaction` | `summary`, `firstKeptEntryId`, `tokensBefore`, `details` | `compaction` |
| `context-edit` | an omitted message (`replacement: null`) | `context_edit` |
| `state` | extension state: a Pi `custom` entry whose type starts with `cherry.` | `custom` |

- **What the model saw** – the message payload is what the bridge sends (one codec in
  `modelMessages.ts`). Reasoning keeps its provider options, so signatures replay to the same model
  key. Images are inline base64.
- **Rebuild** – `SessionManager.inMemory(cwd, { id }, entries)` with the host's ids and
  timestamps, so Pi's compaction, context accounting and extension state behave as in the live
  session. State entries are in place before extensions bind, so `session_start` sees them. The
  transcript is validated first; a bad one throws `TranscriptError` (`invalid_entry`,
  `duplicate_id`, `unsupported_content`, `orphan_tool_result`, `compaction_boundary_missing`,
  `edit_target_missing`) and nothing is created. Tool calls left without a result (a crash
  mid-turn) and failed or aborted replies are valid: Pi answers or skips them when it builds a
  request.
- **Output** – `onEvent` receives `transcript-append` with new entries in Pi order, each exactly
  once; `compaction-start` / `compaction-end` (after the compaction entry was appended); and
  `turn-complete` with the head entry id when a run settles. Pi `system`, `model_change`,
  `thinking_level_change` and `usage` entries are never emitted: the host owns the prompt, the
  model and billing.
- **Tool loadout** – tools activated beyond the session's base tools (by `tool_search`) are
  recorded as a `cherry.tool-loadout` state entry and re-activated on rebuild, after the tools the
  host enables now. Deactivating a base tool is not recorded.

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
- Not carried in the transcript: context edits that replace content (Pi itself only omits
  messages), `bashExecution` and `branch_summary` entries (no Cherry producer), and `isError` on a
  tool result that also holds images.
- The CherryIN Anthropic endpoint omits the thinking block of tool-only replies but requires one on
  replay; Cherry's Pi runtime rebuilds it from the response id (`piThinkingReplay.ts`). The
  transcript keeps `responseId` for this, but requests do not expose it to the port yet.

## Tests

```bash
pnpm test:agent-runtime                              # from the repository root
pnpm --filter @cherrystudio/agent-runtime test       # or the package's own Vitest config
pnpm --filter @cherrystudio/agent-runtime typecheck
```

Tests drive real `streamText` over `MockLanguageModelV3` (and one real provider over local HTTP)
through the same port shape the host implements.
