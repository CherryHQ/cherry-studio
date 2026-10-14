# Pi agent runtime

`createPiRuntime` adapts native Pi sessions to the common runtime contract.
`create` creates a new access; `open` loads an existing native context with an identity check.
Concurrent handles share one execution source; release stops observation, while shutdown closes owned sessions.


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
pnpm test:agent-runtime-pi packages/agent-runtime-pi/tests/nativeSession.test.ts
pnpm --filter @cherrystudio/agent-runtime-pi typecheck
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

## Subagents

`subagents.configure` supplies each child's extensions, native event listener and live-session
callback. A fresh child starts empty; a fork starts at the native assistant entry containing the
calling tool. All tool calls in that entry receive placeholders so simultaneous siblings share
the same model-visible prefix. The parent manager and branch remain unchanged.

Children follow their parent's persistence mode. File-backed parents create native child files in
the same session directory, with a native parent-session link; in-memory parents create in-memory
children. Each child records `cherry.subagent-origin` before extensions start. Subagents cannot
spawn further subagents or ask the user questions. They return final output and usage to the parent.

Each child is limited to 200 model requests, including compaction. Counting wraps the child's
native `agent.streamFunction` and optional custom summarizer, so it is independent of the provider
or transport and does not modify the borrowed model runtime. Abort stops the child and its tools.

## Goals

`createGoalExtension(port)` adds `create_goal`, `get_goal`, `update_goal` and `/goal`. Native
`cherry.goal` entries store snapshots; `cherry.goal-round` messages identify admitted rounds.
Continuation happens at Pi’s settle boundary, with human messages taking priority. Round caps,
token/cost budgets, repeated failures, permission decisions and aborts stop continuation. Usage is
computed from the native branch, including child-tool usage; display snapshots are not a billing
source. A reopened goal starts disarmed and needs an explicit resume. Subagents cannot drive goals.

The host verifies goal completion through `GoalVerifier`, which receives native Pi messages and the native model after replay normalization. AI SDK conversion belongs to the host model binding. Goals restored from native entries start disarmed. The host configures goal approval and permission policy.

## Background work and continuation

A background child returns its ID immediately. `message_subagent` steers a running child or
continues a finished child in the background. `SubagentPort.load(id)` returns its native
`SessionManager`; the ID and origin are checked before opening it. The manager persists any
interrupted-call results added before continuation. There is no event-based storage hand-off.
Use `onSessionCreated` to read the existing native branch and subscribe to streaming events.

The host may provide a different native `model` and borrowed `modelRuntime` for a child.
`findModels` identifies candidates by `provider/id`; continuation preserves the model recorded
in native origin state. A new fork keeps the parent's model/runtime and tool definitions.

Use the returned `prompt` and `compact` wrappers for host operations: they hold result delivery
while Pi prepares or settles. `abort` records a user stop; `stopSubagent` and `backgroundSubagent`
control children individually. Shutdown stops owned children and preserves native history.
With Pi 1.3, every run start takes queued results, including command and goal runs. A quiet
user-stop notification waits for a subsequent run; a completed child may wake the idle parent.

Goal coordination waits for background work and attributes child usage once per `(sessionId, run)`.
A notification delivered at the start of a resumed goal round keeps that round's ownership.
Reopening parent storage restores interrupted/finished child status without restarting work.
