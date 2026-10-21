# Pi agent runtime

`createPiRuntime` adapts native Pi 1.3.0 sessions to the common runtime contract.
`create` creates a new access; `open` loads an existing native context and checks its identity.
Concurrent handles share execution and observation. Releasing a handle stops its observation;
shutdown aborts owned sessions and disposes their resources without deleting native storage.


Constructs native Pi coding-agent sessions. The caller supplies Pi's `ModelRuntime` and `Model`;
Pi owns the execution loop, tools, context accounting and compaction. The package has no AI SDK
dependency and imports no Cherry application code.

## Session builder

`createAgentRuntimeSession({ modelRuntime, model, cwd, agentDir, ... })` returns a native
`AgentSession` and an asynchronous `dispose()` method. The model runtime is borrowed: the caller
owns credentials and provider registration, and closing a session does not unregister its providers.
Settings, including retries and thinking level, retain native Pi semantics.

The builder uses in-memory settings, disables resource discovery, and accepts
explicit tools, extension factories, system prompts, workspace context files and skill directories.
Without a `systemPrompt` Pi's own prompt is used, and Pi appends a `<cwd>` section either way. No
built-in tool is enabled unless `builtinTools` names it. Workspace `AGENTS.md` / `CLAUDE.md` files
load only with `contextFiles: true`, and skills only from the host's `skillPaths`.
`dispose()` aborts execution, lets extensions handle `session_shutdown`, then disposes the session.
Pi is ESM-only; CommonJS hosts must load the package with dynamic `import()`.

Known gap: Pi's resource loader still resolves its discovery directories while it loads; the
`no*` flags and prompt overrides discard everything it finds there.

## Cherry integration

Cherry registers native Pi providers against its internal gateway in `src/main/ai/runtime/pi/gatewayModelBinding.ts`.
The gateway owns upstream credentials and billing. Pi owns protocol replay, tool execution and session retries.

This package is not wired into the desktop runtime yet. The integration tests live with Cherry's
gateway integration; `tests/nativeSession.test.ts` verifies native provider execution and borrowed-runtime ownership.

```bash
pnpm test:agent-runtime packages/agent-runtime-pi/tests/nativeSession.test.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
```

## Native session storage

Pass `sessionManager: SessionManager.create(cwd, sessionDir)` to create a persistent session, or
`SessionManager.open(file)` to reopen it. Omit the manager for an in-memory session. The host chooses
the location and records the native session ID/file association. Pi writes and reads its own JSONL;
there is no second transcript schema, message conversion for storage, or host event replay.

A native file includes messages, provider signatures, usage and cost, compaction boundaries,
context edits, branch entries, system state and extension entries. Extensions see restored state
at `session_start`. Activated tools are recorded as a native `cherry.tool-loadout` entry and restored
beside the host's current base tools. Reopening context does not resume work automatically.

Pi creates the file lazily, once a user or assistant message exists. Pi's low-level `open` also
accepts a missing path as a new session; hosts loading an existing association must check its
existence and verify the native session ID instead of silently replacing it.

`onEvent` observes copied native entries (`session-append`), compaction start/end, and completed
turns. These events are for observation; storage works without a listener. A slow listener should
hand off its work because callbacks run inline. `dispose()` flushes the final observations.

## Compaction

Pi's native compaction runs, configured by `compaction: { reserveTokens, keepRecentTokens,
enabled?, summarize? }`: it compacts once the context passes `contextWindow - reserveTokens`, and
compacts and retries once when a request overflows; `enabled: false` turns both off and leaves
`session.compact()` working. The host computes both numbers from its own settings. Without
`summarize`, Pi's default summarizer runs on the session model through its native model runtime.

With `summarize`, the host summarizes with its own prompt and model:
`summarize({ reason, sessionId, model, messages, previousSummary?, instructions?, signal })` gets
the compacting session's id and model and the folded native messages after the session model's
replay rules (failed replies left out, tool calls without a result answered); Cherry converts them
only when it calls its summarization model. The text it returns is stored as the summary as is; Pi
frames it when it builds the next context. A summarizer that fails, or returns an empty summary,
cancels that compaction (it never falls back to the session model), and `compaction-end` carries
the error.

## Tool output offload

`offload: { store, thresholdChars }` keeps one oversized tool result from overflowing the context.
A `tool_result` hook, after every other extension's, saves text output longer than
`thresholdChars` (and than 3,000 characters, so the marker is always shorter than the output)
through the host's `ToolOutputStore` and gives the model its head and tail around a
`<persisted-output>` note with the saved path, to read back with Pi's `read` tool. If the store
throws, the note gives its error instead and the model keeps only the head and tail. Names are
content addressed (`tool-output-<first 16 hex digits of its sha256>.txt`), so the same output gives
the same marker and prompt caches hold. Images and `structuredContent` are kept. Not offloaded:
errors, `read` results (reading an offloaded file back must not offload it again) and nested tool
calls, which reach the model only through their caller. Pi persists the marker, which is what the
model saw.

Host obligation: let `read` open the store's paths without an approval prompt.

## Recall

`recall: true` registers `vcc_recall`, with pi-vcc's tool name and parameters (`query`, `range`,
`expand`, `page`, `scope`, `mode`), so existing tool settings and approvals apply; the host
disables it by name like any tool. It reads the native active branch, including messages a
compaction folded into its summary and the running turn. `#N` is an entry's position among the
branch's user, assistant, tool-result and custom messages, so it stays the same once the session
is reopened.
`query` is a keyword search (entries matching more of the words first, 5 per page), `range:
[from, to]` lists entries in order (20 per page), `expand: [N]` returns full text, and no argument
lists the latest entries. `scope: 'all'` is the same as `'lineage'`.

## Known gaps

- `vcc_recall` has no regex search, `mode: 'touched'` (files worked on) or `#N:path` file
  drill-down; compaction summaries do not cite `#N` entries.
- `read` results are never offloaded, and Pi caps them at 2,000 lines or 50 KB, which can still
  overflow a small context window.
- A parallel tool batch whose results together exceed the context window, each below the
  threshold, still overflows; offloading at `turn_end` is deferred.
- Pi's `bash` tool saves the full output of a truncated command to a temp file and names it in the
  result; that file is not moved into the offload store and may be gone when read later.
