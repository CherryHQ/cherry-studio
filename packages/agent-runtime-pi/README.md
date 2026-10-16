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
| `message` | AI SDK `ModelMessage` (`user`, `assistant`, `tool` with one `tool-result`), plus `modelKey`, `usage` (token counts and `cost`, the USD the reply was billed at; absent reads as 0), `stopReason`, `errorMessage`, `responseId` (assistant) and `details` and `usage` (tool: what the tool reported for its own work, e.g. a subagent's requests) | `message` |
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
model: `summarize({ sessionId, reason, messages, previousSummary, instructions, signal })` receives
the compacting session's `sessionId` (a subagent's is the id `SubagentPort.configure` received, so a
host can tell its compaction from its parent's) and the folded messages as AI SDK messages, after the session model's replay rules (failed replies left out, tool
calls without a result answered), so they can be sent as they are, and returns the summary text, which is stored as is; Pi frames it when it
builds the context. A failing summarizer cancels that compaction (it never falls back to the session
model) and `compaction-end` carries the error: a threshold compaction leaves the turn running, an
overflow then ends the turn with the provider's error.

## Tool output offload

`offload: { store, thresholdChars }` keeps one oversized tool result from overflowing the context.
A `tool_result` hook, after every other extension's, saves each contiguous text span longer than
`thresholdChars` (and than 3,000 characters, so the marker is always shorter than the output)
through the host's `ToolOutputStore` and gives the model its head and tail around a
`<persisted-output>` note with the saved path, to read back with Pi's `read` tool. If the store
throws, the note gives its error instead and the model keeps only the head and tail. Names are
content addressed (`tool-output-<first 16 hex digits of its sha256>.txt`), so the same output gives
the same marker and prompt caches hold. Images retain their positions between text spans, and `structuredContent` is kept. Not offloaded:
errors, `read` results (reading an offloaded file back must not offload it again) and nested tool
calls, which reach the model only through their caller. Pi persists the marker, which is what the
model saw.

Host obligation: let `read` open the store's paths without an approval prompt.

## Recall

`recall: true` registers `vcc_recall`, with pi-vcc's tool name and parameters (`query`, `range`,
`expand`, `page`, `scope`, `mode`), so existing tool settings and approvals apply; the host disables
it by name like any tool. It reads this session's transcript: the full replayed path plus every entry
since, including the running turn. `#N` is an entry's position among the message entries, so it stays
the same once the host stores the running turn and rebuilds. `query` is a keyword search (entries matching more of the
words first, 5 per page), `range: [from, to]` lists entries in order (20 per page) and `expand: [N]`
returns full text. `scope: 'all'` is the same as `'lineage'`: edits drop the turns after them.

## Subagents

`subagents: SubagentPort` registers `subagent({ description, prompt, fork? })`, a `model-only` tool with DSH's
name, so Cherry's renderer shows it as a Task card. Each call builds a session in-process from the
parent's options (port, request options, model, prompts, tools, compaction, offload, recall,
settings) plus the extensions the host returns from `SubagentPort.configure(subagent)`, starts it
with `session.prompt()` so `before_agent_start` handlers run as in any turn, waits for it to settle
and disposes it. It shares the parent's `sideChannel`, so its requests' errors and unmapped parts
reach the parent's side channel, told apart by the request `sessionId`; the parent's
`extensionFactories` and `onEvent` are not inherited. The call blocks: the subagent's final message
is the call's result, `details` is `{ sessionId, fork, outcome }`, and the result's `usage` is the
sum of the subagent's replies (for budgets; the host already accounted each request). Its transcript
events go only to the `onEvent` the host returned; `onSessionCreated` receives its session before
its first request. Its session id is `<parent session id>.<random UUID>`, unique per subagent even
when provider call ids repeat; treat it as opaque. Subagent calls of one step run at the same time,
and a fresh subagent has no `subagent` tool of its own.

A subagent's session holds a `cherry.subagent-origin` state entry (`{ parentToolCallId, fork }`),
never sent to the model; `AskUserQuestion` ends there as `unavailable` without asking the port.
To find a subagent again: once it ends, the parent's tool result carries its id in
`details.sessionId`; while it runs, or when its call never returns, `configure` has already handed
the host its `parentToolCallId` and its `sessionId`, which starts with the parent's id. The origin
entry is part of the transcript the subagent starts from (after the forked prefix for a fork), so
`onEvent` never emits it; only the live session that `onSessionCreated` receives holds it.

`fork: true` starts the subagent from the parent's transcript up to the assistant message holding the
call, every call of that message answered by the same placeholder, so forks of one step send the same
prefix and can share the prompt cache. A fork keeps the parent's tools, `subagent` included, and the
host must return the parent's extensions for it; calls a subagent may not make (another `subagent`,
`AskUserQuestion`) fail or end as `unavailable` instead of being removed.

A subagent that fails, is cut off by its output limit, is aborted with the parent's turn or would
start a 201st model request returns an `isError` result with the reason, its last partial output,
`details` and `usage`; `outcome` is `failed`, `truncated`, `aborted` or `limit_reached`. Requests
are counted where its session makes them: its turns and the compaction summaries made for it (Pi's
own summarizer through the port, or the host's `compaction.summarize`) alike, and the 201st is
refused before it goes out. A host whose `configure` throws fails that call only.

## Extensions

Factories the host passes in `extensionFactories`. Both tools are `model-only` (never callable from
codemode scripts, so every call stays its own tool part) and use the names Cherry's renderer already
handles.

- **`createTodoExtension()`** – `todo_write` with dsh's schema: `{ todos: { content, status }[] }`,
  status `pending | in_progress | completed`, no other item fields. Every call carries the whole list
  and replaces the previous one; content is trimmed and must be non-empty and unique, and at most one
  todo may be `in_progress`. Invalid lists come back as error results. `details` is
  `{ todos, counts }`. The extension keeps no state: the latest list is the last successful
  `todo_write` on the transcript's active path, so it follows forks and edits and the model sees it in
  the rebuilt history, until a compaction folds that call into the summary.
- **`createAskUserExtension(port)`** – `AskUserQuestion` with Claude Code's input schema (1–4
  questions, each with a `header`, 2–4 options and `multiSelect`; question texts must differ, since
  answers are keyed by them, and so must the option labels of a question, since answers name them).
  The tool waits on `AskUserPort.ask`, which resolves `answered` (`answers`, optional `annotations`
  notes), `declined` (optional `feedback`) or `unavailable` (no one can answer, e.g. a channel or
  scheduled run); inside a subagent's session it ends as `unavailable` without asking the port. The
  result text tells the model what happened; only `answered` is a success. Every result the tool
  returns, aborted included, has `details` `{ questions, answers, annotations? }`;
  invalid input and a rejecting port fail the call with empty `details`. Calls in
  one model step run one at a time. When the turn aborts, the tool stops waiting at once and the
  request's `signal` aborts so the host can withdraw the question; a late answer is ignored. A
  question pending at a crash is not persisted: the rebuilt session closes the call as failed.

The host's approval layer must not ask approval for `AskUserQuestion` (the question is itself the
interaction, or the user would be asked twice) and may auto-allow `todo_write` (it only changes the
session's list). `ASK_USER_TOOL_NAME` and `TODO_TOOL_NAME` hold the names.

The approval layer may auto-allow `subagent` as long as `SubagentPort.configure()` returns the
approval extension, so each call the subagent makes is approved on its own.

## Known gaps

- `vcc_recall` has no regex search, `mode: 'touched'` (files worked on) or `#N:path` file
  drill-down yet; compaction summaries do not cite `#N` entries.
- `read` results are never offloaded, and Pi caps them at 50 KB, which can still overflow a small
  context window.
- A parallel tool batch whose results together exceed the context window, each below the
  threshold, still overflows; offloading at `turn_end` is deferred.
- Pi's `bash` tool saves the full output of a truncated command to a temp file and names it in the
  result; that file is not moved into the offload store and may be gone when read later.
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
  transcript keeps `responseId` for this, but requests do not expose it to the port yet; how they
  will is decided when the host is wired up.
- A fork's requests carry the subagent's session id, so a host that routes prompt caches by session id
  (OpenAI's `prompt_cache_key`) does not reach the parent's cache partition.

## Tests

```bash
pnpm test:agent-runtime                              # from the repository root
pnpm --filter @cherrystudio/agent-runtime test       # or the package's own Vitest config
pnpm --filter @cherrystudio/agent-runtime typecheck
```

Tests drive real `streamText` over `MockLanguageModelV3` (and one real provider over local HTTP)
through the same port shape the host implements.
