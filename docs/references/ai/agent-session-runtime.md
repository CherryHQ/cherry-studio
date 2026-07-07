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

Starting a query (warm or cold) registers the agent's MCP servers and lists
their tools. That listing is **cache-only** — it never connects to an upstream
MCP server — so a dead or slow server cannot block startup. See
[Tool Registry → Tool catalog reads never block on MCP](./tool-registry.md#tool-catalog-reads-never-block-on-mcp).

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

## pi driver resource boundary

pi runs in-process through the SDK, but Cherry still owns the runtime boundary.
The driver must not import the user's standalone pi setup from `~/.pi/agent`,
and must not silently trust executable or prompt resources from a workspace.

Allowed in v1:

- Cherry-owned pi home for SDK runtime state: `application.getPath('feature.agents.pi.root')`,
  exported to pi as `PI_CODING_AGENT_DIR`. This is not a prompt/skill import
  surface in v1.
- Cherry-owned pi sessions: `application.getPath('feature.agents.pi.sessions')`,
  exported as `PI_CODING_AGENT_SESSION_DIR`. The resume token is the pi session
  id; reopen resolves it by scanning this directory for `*_<id>.jsonl`, so the
  directory can be relocated without invalidating stored tokens.
- Cherry agent instructions from the agent record, via `systemPromptOverride`.
  Soul-mode agents override with the assembled CherryClaw persona
  (`PromptBuilder` — SOUL.md/USER.md/FACT.md + autonomy-tool guidance +
  bootstrap) instead of the plain instructions, mirroring the claude driver.
- Inline Cherry-owned extensions required for the integration: provider
  injection and tool approval/policy enforcement.
- Soul-mode autonomy tools (`cron`/`notify`/`config`/`memory`) as pi
  `customTools`, built from the runtime-neutral definitions in
  `ai/agents/tools`. The approval gate auto-approves these Cherry-owned tools
  in every permission mode (unattended heartbeat turns must not block on a
  renderer prompt), but `disabledTools` still hard-blocks them. Soul is opt-in
  for pi (create default off) since pi tools run at main-process privilege.
- The agent's selected MCP servers (`agent.mcps`) bridged into `customTools` via
  `piMcpToolAdapter`, proxying each call to `McpRuntimeService` (the same runtime
  the claude SDK bridge uses). Unlike the soul tools these are third-party and
  are NOT added to `autoApprovedTools` — the approval gate treats a namespaced
  `mcp__…` tool like any other (prompts in default/acceptEdits, allowed in
  bypassPermissions). The catalog is warmed once (`refreshTools`, `allSettled`)
  so a cold cache after boot is not empty and a dead server neither blocks nor
  fails session start.
- The agent's enabled Cherry-managed skills, passed explicitly as
  `additionalSkillPaths` (their canonical `{dataPath}/Skills/<folderName>` dirs).
  These load even under `noSkills` because the paths are Cherry-owned and
  resolved from the `agent_skill` join, not discovered from disk.

Disallowed in v1 unless Cherry adds an explicit trust/import flow:

- User-global pi resources under the standalone pi home (`~/.pi/agent`) or user
  skill folders such as `~/.agents/skills`.
+- Disk prompts from any pi home, including Cherry-owned `SYSTEM.md` and
  `APPEND_SYSTEM.md`; the agent record is the only persona source in v1.
- Workspace project resources: `.pi/extensions`, `.pi/skills`, `.pi/prompts`,
  `.pi/themes`, `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`.
- Workspace context files discovered from the cwd ancestry, including
  `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, and `CLAUDE.MD`.
- Project `.agents/skills` discovered from the cwd ancestry.

The implementation enforces this by creating pi `SettingsManager` with
`projectTrusted: false`, passing empty `systemPrompt` / `appendSystemPrompt` so
pi does not discover prompt files from disk, and constructing
`DefaultResourceLoader` with `noExtensions`, `noSkills`, `noPromptTemplates`,
`noThemes`, and `noContextFiles`. Inline extension factories still load because
they are passed by Cherry code, not discovered from disk; likewise the agent's
enabled managed skills load via `additionalSkillPaths`, which pi honors even
under `noSkills` because the paths are supplied by Cherry, not disk-discovered.

If future work enables workspace pi resources, it must add a Cherry-owned trust
prompt and persisted decision first, then selectively pass that decision into
pi resource loading. Do not rely on pi's default `projectTrusted=true` behavior.

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
