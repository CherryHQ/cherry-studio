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
`dispose()` aborts execution, lets extensions handle `session_shutdown`, then disposes the session.
Pi is ESM-only; CommonJS hosts must load the package with dynamic `import()`.

## Cherry integration

Cherry's AI SDK provider bridge lives in `src/main/ai/runtime/pi/aiSdkModelBinding.ts`. It supplies
native model configuration and installs its tool-call guard before approval handlers. AI SDK
conversion, retries, provider metadata and request side channels stay in Cherry.

This package is not wired into the desktop runtime yet. The integration tests live with Cherry's
bridge; `tests/nativeSession.test.ts` verifies native provider execution and borrowed-runtime ownership.

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

## Context features

- `compaction` sets Pi's reserve/recent token budgets. Its optional summarizer receives native Pi
  messages after replay rules, the session/model identity, previous summary, instructions and an
  abort signal. Cherry converts those messages only when calling its summarization model. A failed
  custom summarizer cancels compaction instead of falling back to an unintended model.
- `offload` saves oversized tool output through a host-supplied store and replaces it with a marker.
  Pi persists that marker because it is what the model saw. Errors and `read` results stay whole;
  several individually small results can still exceed the total context window.
- `recall` exposes `vcc_recall` over the native active branch, including messages folded into a
  compaction summary. Message positions remain stable after reopen. Regex, touched-file and lineage
  search beyond that branch are not implemented.

## Interaction extensions

`createTodoExtension()` registers `todo_write`. Each call replaces the full list; content must be
non-empty and unique, with at most one item in progress. Read the latest list from the last
successful native tool result. Compaction can fold that result into the summary.

`createAskUserExtension(port)` registers `AskUserQuestion`. The host answers, declines, or reports
that no one is available. Questions and option labels must be distinct. Aborting the turn aborts
the host request and ignores a late answer. Every completed result includes the questions,
answers and outcome in native tool-result details. A pending question is not resumed after a
restart. The question itself is the interaction, so the host should not add a second approval.
