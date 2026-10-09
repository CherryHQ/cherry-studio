# Pi agent runtime

`createPiRuntime` adapts native Pi 1.4.0 sessions to the common runtime contract.
`create` creates a new access; `open` loads an existing native context and checks its identity.
Concurrent handles share execution and observation. Releasing a handle stops its observation;
shutdown aborts owned sessions and disposes their resources without deleting native storage.

The caller supplies a borrowed native `ModelRuntime` and `Model`, a working directory and an agent
directory. Credentials and provider registration remain with the caller. Closing the runtime leaves
the supplied model runtime usable. Content uses the common AI SDK message protocol; this package has no Cherry application dependency.


Constructs native Pi coding-agent sessions. The caller supplies Pi's `ModelRuntime` and `Model`;
Pi owns the execution loop, tools, context accounting and compaction. Content uses the common AI SDK message protocol; the package imports no Cherry application code.
Native deltas accumulate once into ordered SDK messages, including preliminary/final tool results.



## Session builder

`createAgentRuntimeSession` builds an `AgentSession` entirely in memory: in-memory credentials,
models and settings, `SessionManager.inMemory` rebuilt from the host's transcript, and a
`DefaultResourceLoader` with extension, skill, prompt-template and theme discovery off. The host
supplies the system prompt (Pi's own prompt when omitted; Pi still appends a `<cwd>` section) and any
appended prompt, custom tools, the enabled built-in tools (none by default), extra extension
factories, the model descriptor, compaction and Pi settings such as `shellCommandPrefix`. It may
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

## Compaction

Pi's native compaction runs, configured by `compaction: { reserveTokens, keepRecentTokens,
enabled?, summarize? }`: it compacts once the context passes `contextWindow - reserveTokens` (also
mid-turn, before the next model request) and compacts and retries once when a request overflows.
The host computes both numbers from its own settings. Without `summarize`, Pi's default summarizer
runs on the session model through the port. With it, the host summarizes with its own prompt and
model: `summarize({ reason, messages, previousSummary, instructions, signal })` receives the folded
messages as AI SDK messages and returns the summary text, which is stored as is; Pi frames it when it
builds the context. A failing summarizer cancels that compaction (it never falls back to the session
model) and `compaction-end` carries the error: a threshold compaction leaves the turn running, an
overflow then ends the turn with the provider's error.

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
