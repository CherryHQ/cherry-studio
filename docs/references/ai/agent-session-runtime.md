# Agent Session Runtime

## Purpose

Agent-session streams need a stable host for UI turns, persistence, live
follow-ups (steers), and recovery. The host must not know whether the
underlying agent uses a long-lived process, a websocket, one HTTP request
per turn, or Claude Code's SDK `query`.

The boundary is:

- `AgentSessionRuntimeService` owns Cherry's UI/session lifecycle.
- `AgentSessionRuntimeDriver` owns the concrete agent-session runtime lifecycle.

Claude Code is the first driver. Its `query`, warm query, SDK input
queue, and `resume` handling are driver internals.

## Ownership

| Owner | Responsibility |
|---|---|
| `AgentChatContextProvider` | Validates the agent session, persists the user row (plus a pending assistant row on a fresh turn), and either starts a turn or enqueues a follow-up through the runtime. |
| `AgentSessionRuntimeService` | Owns one runtime entry per session: current UI turn, pending UI queue, runtime connection, latest resume token, terminal listeners, persistence, and idle timer. |
| `AgentSessionRuntimeDriver` | Connects to one concrete agent implementation and exposes `send`, optional `redirect` (mid-turn steer) and `applyPolicyUpdate`, `close`, and an event stream. |
| `AiStreamManager` | Keeps the normal topic stream contract: start a turn, attach a follow-up subscriber to a live turn, pause the current runtime turn, and start the next runtime turn. |
| `AiService.streamText()` | Routes `request.runtime.kind === 'agent-session'` to `AgentSessionRuntimeService.openTurnStream()` and rejects agent-session topics that do not carry runtime metadata. |
| `ClaudeCodeRuntimeDriver` | Converts Claude SDK messages into generic runtime events and maps opaque resume tokens to Claude SDK `resume`. |

## Fresh turn

1. Renderer sends `Ai_Stream_Open` for topic `agent-session:<sessionId>`.
2. `AgentChatContextProvider` validates the session:
   - the session must have an agent and workspace;
   - the workspace path must pass `assertClaudeCodeWorkspaceDirectory`;
   - the agent type must have a registered runtime driver;
   - the agent must have a model.
3. The provider atomically saves:
   - a `user` message with the submitted parts;
   - a pending `assistant` message with the selected model id.
4. The provider calls `AgentSessionRuntimeService.beginTurn(...)`.
5. `beginTurn()` returns:
   - a runtime persistence listener;
   - a runtime terminal listener;
   - a trace flush listener for `agent-session:${sessionId}` history files;
   - a `turnId`.
   Follow-up messages are not queued here — they live on the session
   entry's `pendingTurns`, appended by `enqueueUserMessage()`.
6. The prepared model request includes:
   - `runtime: { kind: 'agent-session', sessionId, turnId }`;
   - `messageId` set to the pending assistant row;
   - seed `messages`: the user row plus the empty assistant row.
7. `AiStreamManager` starts the execution. `AiService.streamText()`
   detects the runtime metadata and calls `openTurnStream()` instead of
   building a generic `Agent`.
8. `openTurnStream()` ensures there is a runtime connection and admits
   the turn by calling `connection.send({ message })`.

## Live follow-up

If the same topic already has a live stream, `AgentChatContextProvider`
does **not** create a new assistant placeholder and does **not** call
`beginTurn()` again. It persists the new user row, hands the message to
`AgentSessionRuntimeService.enqueueUserMessage(sessionId, message)`, and
returns a `PreparedDispatch` with `models: []` so `AiStreamManager.send()`
takes the **inject** path — which for agent sessions only upserts the new
subscriber onto the running stream (no message is injected into the
execution; chat's abort-and-restart does not apply here).

A live follow-up is a **steer**. Steering is queue-based, never an
interrupt: the current turn is **never aborted** to apply a steer (a user
Stop is now the only abort source). `enqueueUserMessage()`:

1. **Live turn + a driver that can steer** — calls
   `connection.redirect({ message, systemReminder: true })`. The driver
   stashes the steer and injects it into the running turn (Claude Code
   does this via a `PreToolUse` hook, as `additionalContext` before the
   next tool runs). The message is folded into the current turn — no new
   turn, no queue entry. If the turn ends before the steer is injected
   (it called no tool after the steer arrived), the connection emits
   `steer-undelivered` and the host queues it as the next turn.
2. **No live turn, or the driver cannot steer** — appends the message to
   the session entry's `pendingTurns` (recording its id in
   `steerMessageIds` so the next turn wraps it in a steer system-reminder)
   and schedules the next turn.

When a steer **is** injected mid-turn, the driver emits a
`steer-boundary` just before the model's post-steer assistant message.
The host then **rolls** the assistant row: it finalises the pre-steer
parts as one row (A1a), opens a fresh continuation row (A2), and replays
the buffered post-steer chunks into A2 — so the steer user message sorts
between the two assistant rows instead of dangling after the whole turn.
`willContinueTopic()` keeps the topic stream alive across the roll (and
across a mid-flight compaction) so the continuation carries the renderer
listeners.

## Starting the next runtime turn

When a completed runtime turn still has queued follow-ups (or a
`steer-undelivered` requeue), `AgentSessionRuntimeService.startNextTurn()`:

1. shifts the next user message off the session entry's `pendingTurns`;
2. saves a new pending assistant row;
3. creates a fresh `turnId`;
4. calls `AiStreamManager.startRuntimeTurn(...)` with:
   - the same topic id and model id;
   - `runtime: { kind: 'agent-session', sessionId, turnId }`;
   - seed messages containing the user row and empty assistant row.

The runtime connection may stay on the entry. What that means is driver
specific: Claude Code keeps its SDK query/input queue, while another
driver could keep a websocket or reconnect per turn.

## Resume token persistence

Drivers may emit:

```ts
{ type: 'resume-token'; token: string }
```

The host treats the value as opaque. It stores it as
`entry.lastResumeToken` and passes `runtimeResumeToken` to
`AgentSessionMessageBackend`, so the final assistant row receives the
latest resume token at terminal time.

This also covers error turns: if a driver emitted a resume token and then
failed, the assistant error row still records that token so the next
connection can recover from the newest driver-known state.

User rows do not need a resume token. The durable recovery anchor is the
latest assistant row with `runtimeResumeToken`.

For Claude Code, the resume token is the SDK `session_id`. The driver
maps it to `options.resume`. This is separate from the SDK's file
checkpointing / `rewindFiles()` feature, which uses user-message UUIDs
to restore files.

## Claude Code driver

Normal multi-turn chat does not use `continue: true` and does not rely
on cwd-based session discovery.

When `ClaudeCodeRuntimeDriver.connect()` needs to create a query, it
asks `buildClaudeCodeQueryRequestForAgentSession(sessionId, resumeToken)`.
The builder uses the first available value:

1. explicit resume token from the host;
2. latest persisted agent-session resume token from
   `agentSessionMessageService.getLastRuntimeResumeToken(session.id)`;
3. no resume id for a brand-new SDK session.

The query may come from `ClaudeCodeWarmQueryManager.consume(...)` if a
prewarmed query is available. Otherwise the driver starts a new SDK
query with `createClaudeQuery({ prompt: driverSdkInputQueue, options })`.

The driver converts Claude SDK messages into runtime events:

- `stream_event` / assistant/user messages -> `chunk`;
- `system/init` -> `resume-token`;
- `result` -> `resume-token`, a usage `chunk`, `context-usage`, and `turn-complete`;
- a `PreToolUse` steer injection (armed by `redirect()`) -> `steer-boundary`
  before the post-steer assistant message; a steer the turn never injected
  -> `steer-undelivered`;
- `system/status status: 'compacting'` -> `compaction-start`;
  `system/compact_boundary` -> `compaction-complete` (with anchor);
  `system/status compact_result: 'success'` with no boundary ->
  `compaction-complete` (no anchor, idempotent settle);
  `compact_result: 'failed'` / `compact_error` -> `compaction-error`;
- thrown errors -> `error` (or a salvaged `turn-complete` for a truncated stream).

`applyPolicyUpdate` carries live agent edits onto the warm connection: a
`permission-mode` change awaits the SDK `setPermissionMode` before mutating
the snapshot (short-circuiting an unchanged mode), and a `tool-policy`
change refreshes the snapshot's disabled set in place. A rejected update is
failed closed by the host (the connection is torn down) rather than left
running under the old policy.

## Idle and shutdown

After a turn reaches terminal state, the runtime entry becomes `idle`.
For a short idle window it keeps:

- the runtime connection, if it is still alive;
- `lastResumeToken`;
- the session entry's `pendingTurns`.

If a new turn arrives during that window, `beginTurn()` reuses the same
entry and only swaps the current UI turn plus the UI pending queue.

When the idle timer expires, the runtime closes the entry:

- clears `pendingTurns`;
- closes the runtime connection;
- prewarms Claude Code when a latest resume token is known.

Service stop and destroy close all runtime entries.

## Removed old path

Claude Code is not a normal provider extension anymore:

- no `createClaudeCode`;
- no `ClaudeCodeLanguageModel`;
- no `ClaudeCodeProviderSettings`;
- no `injectedMessageSource` in provider settings;
- no `providerToAiSdkConfig(..., { runtimeResumeToken })` branch.

Any `agent-session:*` stream that reaches `AiService.streamText()`
without runtime metadata is rejected. That fail-fast rule prevents a
regression back to one CLI process per turn without the long-lived SDK
input queue inside the Claude Code driver.

## Verification

Focused tests:

- `src/main/ai/streamManager/context/__tests__/AgentChatContextProvider.test.ts`
- `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`
- `src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`
- `src/main/ai/__tests__/AiService.test.ts`
- `src/main/ai/runtime/claudeCode/__tests__/streamAdapter.test.ts`
- `src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeWarmQueryManager.test.ts`
