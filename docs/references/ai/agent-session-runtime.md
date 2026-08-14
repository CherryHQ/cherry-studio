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
| `AgentSessionRuntimeDriver` | Connects to one concrete agent implementation and exposes `send`, serialized `reconcile`, optional `redirect` (mid-turn steer), `close`, and an event stream. |
| `AiStreamManager` | Keeps the normal topic stream contract: start a turn, attach a follow-up subscriber to a live turn, pause the current runtime turn, and start the next runtime turn. |
| `AiService.streamText()` | Routes `request.runtime.kind === 'agent-session'` to `AgentSessionRuntimeService.openTurnStream()` and rejects agent-session topics that do not carry runtime metadata. |
| `ClaudeCodeRuntimeDriver` | Converts Claude SDK messages into generic runtime events and maps opaque resume tokens to Claude SDK `resume`. |
| Usage capture | Direct/external routes emit one record input per Claude SDK assistant request; gateway routes use AiService provider-call middleware and ignore SDK aggregate usage. |
| Runtime timing | `AiStreamManager` owns the message clock. Claude SDK `PostToolUse`/`PostToolUseFailure` hooks contribute tool spans for direct/external and gateway-backed routes using `duration_ms`; approval waits are captured independently from approval request to decision/abort. |

## System prompt ownership

`src/main/ai/runtime/agentPrompt.ts` is the single materializer for Cherry-owned Agent prompt policy. Every runtime passes the same Agent, workspace, agent-data path, channel state, and resolved citation guidance into `buildAgentRuntimePrompt()`, then maps its `{ base, append }` result into the runtime SDK.

The common materializer owns Cherry policy content, semantic authority, and the ordering of blocks carried through its `append` result:

1. instruction precedence when an Agent System Prompt exists;
2. bootstrap, identity, and memory context from `PromptBuilder` (`SOUL.md`, `USER.md`, `memory/FACT.md`);
3. runtime-supplied root workspace instructions when the SDK exposes them to the materializer;
4. variable-resolved Agent System Prompt text and its authority wrapper;
5. context required when `system.md` replaces a native base;
6. linked-channel security policy;
7. citation markers for the lookup tools the runtime actually exposes;
8. final-deliverable declaration through `mcp__cherry-tools__report_artifacts`;
9. the configured app response language.

Built-in Agent resolution and provisioning are part of this common path: an empty DB instruction field resolves the current localized bundled definition, the Assistant has a minimal fail-safe role if that bundle is unavailable, and persona/memory files are initialized under the Agent data directory before `PromptBuilder` reads them. A non-empty DB instruction remains user-owned. Prompt variables such as `{{username}}` and `{{model_name}}` are resolved identically for every runtime.

Runtime adapters own only native mechanics:

| Runtime-neutral Cherry policy | Runtime-specific carrier |
|---|---|
| `system.md` selects native vs custom base; Cherry append survives either choice | Claude maps native to the `claude_code` preset; pi leaves `systemPromptOverride` unset. Both pass custom content as the SDK base override. |
| Common append text and block order | Claude uses the preset's `append`; pi uses `appendSystemPromptOverride`. |
| Workspace instruction authority | Claude's `AgentsMdLoader` supplies root text and hooks load nested scopes; pi's `DefaultResourceLoader` supplies its native project-context section after the common append. Physical placement may differ, while the common precedence contract keeps semantic authority identical. |
| Enabled managed skill content | Claude injects its plugin/config representation; pi uses `additionalSkillPaths`. |
| Current workspace guarantee | Claude's preset owns cwd/git context and receives an explicit cwd block only when a custom base replaces it; pi's native builder always appends date and cwd. |
| Coding/runtime handbook and native tool snippets | Owned by the Claude Code or pi base prompt, never copied into the common materializer. |

Do not add Cherry policy directly to one driver. Extend the common materializer, pass any runtime-derived capability fact into it, and add integration assertions for every registered runtime. This module is main-process orchestration, not a cross-process contract, so it does not belong in `@shared`.

## Fresh turn

1. Renderer sends `Ai_Stream_Open` for topic `agent-session:<sessionId>`.
2. `AgentChatContextProvider` validates the session:
   - the session must have an agent and workspace;
   - system workspaces are materialized under Cherry's managed root, while user
     workspace paths must already resolve to a directory;
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

1. **Open normal user turn + a driver that can steer** — calls
   `connection.redirect({ message, systemReminder: true })`. The driver
   stashes the steer and injects it into the running turn (Claude Code
   does this via a `PreToolUse` hook, as `additionalContext` before the
   next tool runs). The message is folded into the current turn — no new
   turn, no queue entry. If the turn ends before the steer is injected
   (it called no tool after the steer arrived), the connection emits
   `steer-undelivered` and the host queues it as the next turn.
2. **No redirect-eligible open normal turn, or a driver that cannot steer** —
   appends the message to the session entry's `pendingTurns` (recording its id in
   `steerMessageIds` so the next turn wraps it in a steer system-reminder)
   and schedules it once runtime ownership returns to `idle`.

A receive-only autonomous generation never accepts a redirect. Follow-ups
remain in `pendingTurns` until terminal persistence releases runtime ownership.
A normal turn whose stream is still `unopened` is queued for the same reason;
steering is only valid after that turn's stream is `open`.

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

A queued successor may start only after the current execution reaches
`turn-terminal` and persistence returns the runtime to `idle`.
`startNextTurn()` rechecks that ownership before reading or shifting the queue,
so a premature launch has no queue, database, or stream-manager side effects.

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

If a queued successor or steer continuation cannot save its assistant
placeholder, the host explicitly terminates the held topic stream with
`terminateHeldTopicStream()`. Broadcasting an error alone is insufficient:
it does not run terminal lifecycle or evict the held stream.

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
- direct/external `stream_event` messages establish one invocation per
  message id and provide terminal usage plus per-request timing; complete
  `assistant` messages are a whole-snapshot usage candidate when the terminal
  delta omits usage. Gateway-owned connections do not emit this record input;
- `system/init` -> `resume-token`;
- a successful `result` -> flush pending per-request usage, then `resume-token`, a
  cumulative usage metadata `chunk` for live UI, `context-usage`, and `turn-complete`;
- a failed `result` -> preserve its final usage and resume token, then emit `error` and
  tear down the connection. This includes SDK envelopes whose subtype is `success` but
  whose `is_error`, `terminal_reason: 'api_error'`, or `api_error_status` fields report
  an API failure;
- a `PreToolUse` steer injection (armed by `redirect()`) -> `steer-boundary`
  before the post-steer assistant message; a steer the turn never injected
  -> `steer-undelivered`;
- `system/status status: 'compacting'` -> `compaction-start`;
  `system/compact_boundary` -> `compaction-complete` (with anchor);
  `system/status compact_result: 'success'` with no boundary ->
  `compaction-complete` (no anchor, idempotent settle);
  `compact_result: 'failed'` / `compact_error` -> `compaction-error`;
- thrown errors -> `error` (or a salvaged `turn-complete` for a truncated stream).

The settings builder also installs `PostToolUse` and
`PostToolUseFailure` hooks. Their SDK-reported `duration_ms` is forwarded to
the active message's `AiStreamManager` timing collector. It is not inferred
from assistant/user chunks and it excludes the permission prompt. A hook that
fires with no active UI turn is not attached to the last message.

The result's cumulative `modelUsage`, duration, and total cost are
reconciliation-only and are never divided across requests. For direct/external
calls, `SDKPartialAssistantMessage.ttft_ms` supplies per-request TTFT.
Completion is TTFT plus the monotonic interval from `message_start` to the
terminal delta/stop; reasoning duration is measured between reasoning and the
first non-reasoning output. If a step omits `ttft_ms`, TTFT and completion stay
null rather than treating stream-only duration as the whole provider call.
Before a steer boundary the driver flushes pending usage, so the host binds
that invocation to the pre-steer assistant row; the next invocation binds to
the continuation row. Gateway-backed connections additionally reserve the
continuation message id synchronously at injection time, before the SDK can
issue that invocation through the local gateway; A2 later reuses the reserved
id when the boundary arrives. See
[AI Usage Records](./ai-usage-records.md#agent-runtime-ownership).

Tool timing and provider usage have separate owners: the post-tool hooks never
write `ai_usage_record`, and SDK assistant usage never manufactures a tool
span. The message performance view joins both read models only in the
renderer.

`reconcile()` carries live agent edits onto the warm connection: a
`permission-mode` change awaits the SDK `setPermissionMode` before mutating
the snapshot (short-circuiting an unchanged mode), and a `tool-policy`
change refreshes the snapshot's disabled set in place. Concurrent push/pull
reconciles are serialized per connection. A rejected update is failed closed
by the host (the connection is torn down) rather than left running under the
old policy.

## pi driver resource boundary

pi runs in-process through the SDK, but Cherry still owns the runtime boundary.
The driver must not import the user's standalone pi setup from `~/.pi/agent`,
and must not silently trust executable or prompt resources from a workspace.

Allowed in v1:

- Cherry-owned pi home under `Data/Agents/.pi`: `application.getPath('feature.agents.pi.root')`,
  passed explicitly as `agentDir`. This is not a prompt/skill import surface.
- Cherry-owned pi sessions: `application.getPath('feature.agents.pi.sessions')`,
  passed explicitly as `sessionDir`. The resume token is the pi session id;
  reopen resolves it by scanning this directory for `*_<id>.jsonl`, so the
  directory can be relocated without invalidating stored tokens.
- Cherry's runtime-neutral Agent prompt, materialized by `buildAgentRuntimePrompt()` and injected
  through `systemPromptOverride` and `appendSystemPromptOverride`. The materializer uses
  `PromptBuilder` for workspace `system.md` and the current agent data directory's `SOUL.md`,
  `USER.md`, and `memory/FACT.md`, and adds the same instruction authority, channel security,
  citation, artifact-reporting, and language contracts as the Claude Code runtime.
  These files are a **connection-lifetime snapshot**: editing them deliberately
  does not invalidate a warm connection or its provider prompt cache. Changes
  apply when that connection is naturally rebuilt or the session is reopened.
- Inline Cherry-owned extensions required for the integration: provider
  injection and tool approval/policy enforcement.
- The complete runtime-neutral result of `buildAgentMcpServers()` — Cherry
  knowledge, memory, skills, assistant/autonomy tools, plus the agent's selected
  MCP servers — converted uniformly to pi `customTools` through an in-memory MCP
  bridge. Every adapted call therefore uses the same naming, metadata, abort,
  and error translation path. A server that cannot connect or list tools is logged
  and omitted, preserving the existing best-effort MCP availability contract; a
  duplicate normalized tool identity is different — it makes approval/routing
  ambiguous, so startup closes all bridge clients and fails materialization.
  The approval extension still distinguishes Cherry-owned
  safe tools, Cherry tools that always require approval, and third-party MCP
  tools; `disabledTools` hard-blocks every class.
- New pi agents start in `acceptEdits`: reads and writes inside the selected
  workspace and current agent data directory do not prompt repeatedly. Shell,
  third-party MCP, Cherry approval-required mutations, external paths, and
  symlink escapes remain gated. `bypassPermissions` does not override the
  runtime-neutral Cherry approval-required policy. Pi exposes neither `plan`
  nor `auto`: the latter depends on Claude's model-side approval classifier,
  which the Pi approval gate does not implement.
- The agent's enabled Cherry-managed skills, passed explicitly as
  `additionalSkillPaths` (their canonical `{dataPath}/Skills/<folderName>` dirs).
  These load even under `noSkills` because the paths are Cherry-owned and
  resolved from the `agent_skill` join, not discovered from disk.
- Workspace context files discovered from the cwd ancestry (`AGENTS.md`,
  `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`). The workspace is trusted because the
  user picked it by hand in Cherry — there is no separate "do you trust this
  project?" prompt, matching the claude driver's `project` context source.
  Context files are workspace **text**, a different trust class than executable
  extensions (which stay off). This is the only project-discovered resource pi
  loads; everything else below is still disabled.

Disallowed in v1 unless Cherry adds an explicit trust/import flow:

- User-global pi resources under the standalone pi home (`~/.pi/agent`) or user
  skill folders such as `~/.agents/skills`.
- Disk prompts from any pi home, including Cherry-owned `SYSTEM.md` and
  `APPEND_SYSTEM.md`; Cherry's `PromptBuilder` is the only persona source.
- Workspace project resources: `.pi/extensions`, `.pi/skills`, `.pi/prompts`,
  `.pi/themes`, `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`.
- Project `.agents/skills` discovered from the cwd ancestry.

The implementation enforces this by creating pi `SettingsManager` with
`projectTrusted: true` (the user-selected workspace is trusted, so its context
files load — parity with the claude driver), then constructing
`DefaultResourceLoader` with `noExtensions`, `noSkills`,
`noPromptTemplates`, and `noThemes` — but `noContextFiles: false`, the one
project-discovered surface pi is allowed. Cherry's prompt overrides suppress
pi-home `SYSTEM.md` discovery. Inline extension factories still load because
they are passed by Cherry code, not discovered from disk; likewise enabled
managed skills load via `additionalSkillPaths` because Cherry supplies those
paths explicitly.

The trust boundary is therefore **executable/prompt resources off, workspace
text on**: `noExtensions`/`noSkills`/`noPromptTemplates`/`noThemes` keep arbitrary
code and Cherry-managed resources from being disk-discovered, while
`projectTrusted: true` + `noContextFiles: false` load only the workspace's own
`AGENTS.md`/`CLAUDE.md` text. If future work enables the still-disabled workspace
resources (extensions, project skills/prompts/themes), it must add a Cherry-owned
trust prompt and persisted decision first, then selectively pass that decision
into pi resource loading rather than widening the `no*` flags wholesale.

Connection startup uses an optimistic materialization snapshot. Cherry warms
the MCP catalog, captures every reconcilable database/catalog fact, constructs
the runtime from that captured provider, model, enabled-key set, skill paths,
MCP rows, and linked channel, then captures those facts again before publishing
the connection.
If the signatures differ, startup fails closed and cleans up the connection's
generation-scoped provider registration. Prompt-file content is deliberately
outside this signature because it follows the connection-lifetime cache
contract above.

Warm Pi reconciles serialize push and pull calls per connection so a slower
older snapshot cannot overwrite a newer policy result. `permission_mode` is
live policy and stays frozen for an active turn. `disabledTools` has two jobs:
the live gate applies newly disabled tools immediately, while the spawn-time
`excludeTools` list controls which tools the model can see. It therefore remains
a rebuild-signature fact; adding or removing a disabled tool returns `rebuild`
after any applicable live tightening has landed.

## Internal Agent continuation normalization

When a Cherry-internal Agent Session request enters the API gateway in Anthropic
Messages format and its converted UIMessage list ends with a text-only assistant
attachment, the gateway appends an ephemeral user continuation after conversion.
The Agent request itself proves that Claude Code's standard loop intends another
sample, so this normalization is independent of the target provider, endpoint,
and model. The original assistant attachment is preserved and the caller's params
are not mutated. The continuation is never written to the database, the SDK
transcript's user-visible history, or the renderer. Direct Anthropic requests do
not enter the gateway, and external gateway requests remain unchanged so their
callers can intentionally use assistant prefill.

## Corrupt resume history recovery

Each Claude Code connection may recover once from either a missing resumed
conversation (`No conversation found with session ID`) or a request-time duplicate
tool-use id failure (`tool_use ids must be unique`). The driver discards the failed
resume token, rebuilds the SDK input queue and query without `resume`, and replays the
pending user input with an empty SDK `session_id`. The replacement query's next
`system/init` advances the normal resume-token persistence path to the new session id.

Duplicate-id recovery is allowed only before the current turn emits any non-metadata
chunk. Text, reasoning, tool calls, tool results, and background-flow chunks all close
that safety gate because replay could repeat visible output or a tool side effect. If
the gate has closed, the driver does not rebuild or replay; it surfaces the original
error. Missing-conversation recovery keeps its existing compatibility behavior and is
not activity-gated, but both reasons share the same one-attempt connection budget.

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

`ClaudeCodeProcessManager` owns every CLI handle this app spawns. Every SDK `Options` object routes
through its host spawn wrapper, which fixes the stdio contract and records each `ChildProcess`,
dropping it on `exit`. Both consuming services `@DependsOn` it, so it initialises first and therefore
stops last — after their queries are closed — instead of relying on registry order.

Graceful cleanup is the close path: warm handles use their async-dispose contract, live queries call
`close()` and await `return()`, and the shared `AbortController` signals the child. Its own `onStop()`
then synchronously sends `SIGTERM` to whatever handle is still registered — a best-effort sweep for
children the connection and warm-query abstractions lost track of. It waits for nothing and escalates
to nothing: shutdown can be cut short by the OS at any point, so a child that must not outlive the app
cannot depend on this running. No process-name lookup or machine-wide kill is used.

Survival past an abrupt exit is the CLI's own responsibility, and it honours it. Holding its stdin as
a pipe is what arms this: when the app dies the write end closes and the CLI sees EOF. Measured on
macOS arm64 with SDK 0.3.220 — `SIGKILL` on the parent leaves the CLI reparented to PID 1 and it exits
by itself ~240ms later; closing only its stdin while the parent stays alive exits it cleanly (code 0)
within ~2s. So the sweep above is an accelerator and a net for lost handles, never the mechanism that
keeps a CLI from outliving the app. Never spawn the CLI with `detached` or with stdin redirected away
from the app — either would disarm this.

## Write quiesce

For backup restore (#16849) the service exposes `pause(reason?): Disposable` +
`drainInFlight({ timeoutMs }) → { stragglerIds }` + `listActiveWork()`, the same
contract as `AiStreamManager` and `JobManager` (see
[stream-manager.md](./stream-manager.md#write-quiesce-pause--draininflight) for the
contract and the orchestration order). This service's autonomous write surface is the
assistant-placeholder `saveMessage` in `startNextTurn` / `startContinuationTurn`; both
are gated at entry, BEFORE consuming `pendingTurns` / `rollSteerInputs` — a suppressed
start stays queued (`isSessionBusy` holds, so concurrent dispatches keep enqueueing) and
the last hold's disposal re-kicks it. New-turn admission through `prepareDispatch` /
`beginTurn` is gated upstream by `AiStreamManager`. The drain awaits
`inFlightTurnStarts` — launches admitted before the pause, through their placeholder
write and `startRuntimeTurn` handoff; the resulting stream writes belong to
`AiStreamManager`'s drain. This is distinct from the BaseService lifecycle pause and
never touches service state.

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
