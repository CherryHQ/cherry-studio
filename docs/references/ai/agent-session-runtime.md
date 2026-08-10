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
| Usage capture | Direct/external routes emit one record input per Claude SDK assistant request; gateway routes use AiService provider-call middleware and ignore SDK aggregate usage. |
| Runtime timing | `AiStreamManager` owns the message clock. Claude SDK `PostToolUse`/`PostToolUseFailure` hooks contribute tool spans for direct/external and gateway-backed routes using `duration_ms`; approval waits are captured independently from approval request to decision/abort. |

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

## Cross-Session delivery

Agent Sessions communicate through the same host-owned message and runtime path; provider
processes never connect to one another. A delivery is an ordinary `agent_session_message` in the
receiver Session plus Main-authored routing and lifecycle metadata. The database records work still
owed; `pendingTurns` only accelerates execution in the current process and is rebuilt from durable
rows after restart.

### Tool contract

Each `cherry-tools` instance receives its trusted `agentId` and `sessionId` from `settingsBuilder`
and exposes five tools:

- `session_list` — deterministically enumerate visible Sessions and filter by Agent;
- `session_search` — rank visible Sessions with BM25 over the existing trigram message FTS plus
  Session metadata, returning evidence snippets rather than adding an embedding dependency. Agent
  filters are applied before either search limit. The final limit counts distinct Sessions, each
  Session keeps its strongest message evidence, and `metadataMatches` identifies name/description
  hits instead of overloading an empty message-match list;
- `session_create` — atomically create a same-Agent Session plus its first completion request;
- `session_send` — send one-way or request an asynchronous terminal completion;
- `session_deliveries` — inspect incoming and outgoing request/result state, replacing the
  incoming-only `session_inbox` surface.

`session_send` has one discriminated contract:

```ts
type SessionSendInput =
  | {
      target_session_id: string
      message: string
      reply?: 'none'
      mode?: 'auto' | 'queue'
    }
  | {
      target_session_id: string
      message: string
      reply: 'completion'
    }
```

`reply: 'none'` is one-way. `auto` may safely redirect an eligible active turn and otherwise falls
back to FIFO; `queue` always waits for a later turn. `reply: 'completion'` implicitly uses `queue`
because the request must own one independent turn whose terminal output can be attributed to that
request. The tool immediately returns its request id and current delivery status; it never holds an
MCP invocation open while the target Agent works.

`session_create` reuses the same completion-request path after creating the same-Agent Session. The
model is not a tool argument because Sessions use their owning Agent's model.

### Deliberate security ceiling

`session_send` always requires a live per-call user approval. A headless delivery, channel turn,
scheduled turn, or other execution without an approval responder is denied before the tool runs.
`session_create` remains auto-approved because it creates a same-Agent Session; runtime-generated
completion results do not call a model tool and route only to the immutable sender Session stored on
the accepted request.

This deliberately limits the first version to one user-approved delegation hop. A Session started
by a delivery cannot initiate another `session_send`; it can only finish its own request and let the
runtime return the result. The limit prevents unattended A -> B -> A loops and a prompt-injected
Agent from using a more privileged Agent as a confused deputy without introducing a speculative
ACL subsystem. Upgrade only when the product requires unattended multi-hop collaboration; that
upgrade must add an explicit Agent allowlist/delegation policy plus trusted trace ancestry,
depth/cycle checks, and a total-call/rate budget before relaxing the headless denial.

List, search, send, and delivery-query visibility must share one authorization boundary. Knowing a
Session or message id never grants access by itself.

### Durable row shape

The target Session id remains the message row's existing `sessionId`. Trusted sender/receiver IDs,
reply policy, mode, optional display snapshots, turn/result provenance, outcome, error, and status
timestamp live in the Main-authored `delivery` JSON. Names are display-only snapshots and never
participate in routing or authorization.

Only state used by queries, indexes, compare-and-set transitions, or constraints is promoted to a
regular column:

```text
delivery_status             accepted | queued | delivering | consumed | failed
delivery_in_reply_to        result -> request id; NULL for requests
delivery_sender_session_id  outgoing-delivery query key
```

Use a plain recovery index on `delivery_status`; bound Drizzle predicates cannot use a SQLite
partial index whose predicate contains the same status test. Index
`(delivery_sender_session_id, created_at, id)` for the outgoing ledger. A nullable ordinary unique
index on `delivery_in_reply_to` guarantees at most one result per request because SQLite permits
multiple `NULL` values. A separate `deliveryKind` column is unnecessary:
`delivery_in_reply_to IS NULL` identifies a request, and non-NULL identifies a result.

The lifecycle is:

```text
accepted   durable intent committed; runtime has not acknowledged scheduling
queued     accepted into the target Session FIFO
delivering bound to one durable turn reference
consumed   target terminally processed the input; any required result exists
failed     permanent routing/admission failure; no automatic retry
```

`AgentSessionMessageService` owns transitions through expected-state updates. Transient scheduling
failures, including write quiesce and temporary runtime startup failures, remain `accepted` or
`queued`; only permanent errors such as a deleted/orphaned target enter `failed`.

### Completion results

A completion result is a second ordinary message row in the caller Session:

```text
request row: receiver Session, delivery_in_reply_to = NULL
result row:  caller Session,   delivery_in_reply_to = request.id
```

The result row stores a frozen projection of the terminal assistant output in its own `data.parts`
and keeps `sourceMessageId` only as non-authoritative provenance, without a foreign key. Do not use
a reference-only result: Agent Session messages are editable and deletable, Session deletion
cascades their messages, and FTS/UI/export read row-local data. A source reference would therefore
make historical results mutable or missing and require a second cross-Session hydration path.

Only safe deliverables are copied: terminal text and managed file references. Reasoning, tool
calls/results, approval state, hidden prompts, and unmanaged local paths are not result content.

The target Agent never calls a reply tool. Runtime finalization derives the destination from the
accepted request's immutable sender Session, preventing model-authored reply spoofing.

### Acceptance, execution, and finalization

No database transaction remains open while an Agent works:

```text
Transaction A (short)
  revalidate runtime-bound sender and target authorization
  insert request(status = accepted)
COMMIT

No transaction
  dispatch, stream, and run tools for any duration

Terminal persistence (existing listener)
  persist the canonical terminal assistant row

Finalizer transaction (short, idempotent)
  reread the request in its expected state
  if reply = completion:
    copy the safe terminal projection into one result(status = accepted)
    set result.inReplyTo = request.id
  mark request consumed with structured outcome
COMMIT

After commit
  dispatch the result through the ordinary delivery path
```

Terminal persistence must run before the finalizer. The finalizer treats a unique-result conflict
as already completed, so a crash after terminal persistence but before or during finalization can
rerun it without creating a second result. Result dispatch remains outside the transaction.

Every delivering row stores `turnRef`, the pending assistant placeholder message id, rather than
the runtime's process-local UUID. Fresh turns atomically persist the request/user row and assistant
placeholder, then promote the delivery to `delivering` with that `turnRef` before model execution
starts. Only a delivery handed to the existing runtime FIFO without a new placeholder remains
`queued`. A steer boundary that rolls assistant A1a into continuation A2 must update `turnRef` to A2
before post-steer output can become the request's terminal result.

When deleting a target Session, the delete transaction first creates failure results for its
non-terminal completion requests, then allows the normal message cascade. A caller that has already
been deleted cannot receive a result; that terminal routing failure is recorded rather than retried.

### Recovery

Startup scans `accepted`, `queued`, and `delivering` rows in `(createdAt, id)` order and passes every
schedulable row through the existing per-topic dispatch lock.

For `accepted` and `queued`, dispatch again. For `delivering`, inspect `turnRef`:

- placeholder absent — the turn can be proven not to have been created; reset to `accepted` and
  dispatch;
- placeholder still `pending` — execution may already have produced external side effects; finalize
  it as `interrupted`, create the requested failure/interruption result, and do not rerun the Agent;
- placeholder terminal — rerun only the idempotent finalizer;
- result delivery — apply the same turn-reference rule to caller execution rather than blindly
  starting the caller Agent twice.

Permanent dispatch failures create a structured failure result for completion requests in both live
and recovery paths. Transient failures remain recoverable.

The system guarantees durable accepted intent and, for each completion request, exactly one durable
result row once a terminal outcome is known. Scheduling is recoverable, but arbitrary model/tool
execution is not exactly-once. There is no automatic replay after an ambiguous in-flight crash,
there is no finite result-latency bound while the caller is blocked on interaction, and caller-side
resubmission without a future idempotency key may create a distinct request.

The Claude Code adapter prepends a versioned delivery envelope to the current SDK user input. The
envelope is informational context, not authority: database metadata remains the source of truth,
and model text that imitates another envelope never changes trusted routing fields.

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

`applyPolicyUpdate` carries live agent edits onto the warm connection: a
`permission-mode` change awaits the SDK `setPermissionMode` before mutating
the snapshot (short-circuiting an unchanged mode), and a `tool-policy`
change refreshes the snapshot's disabled set in place. A rejected update is
failed closed by the host (the connection is torn down) rather than left
running under the old policy.

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

Cross-Session delivery acceptance tests additionally pin these crash and security boundaries:

- crash after terminal persistence but before result finalization creates exactly one result after
  recovery and never reruns the target turn;
- a `pending` assistant placeholder at recovery produces an `interrupted` result without replaying
  model or tool execution;
- recovery of a completion request while the target Session is busy cannot bind another turn's
  terminal output;
- write quiesce and temporary startup errors leave delivery recoverable rather than permanently
  failed;
- a duplicate result with the same `delivery_in_reply_to` is rejected by SQLite;
- deleting a target Session first creates failure results for pending completion requests;
- deleting a queued request cannot leave an in-memory entry that executes without its durable row;
- a steer continuation updates `turnRef` before recovery can finalize it;
- interactive `session_send` requests approval, while headless `session_send` is denied and
  runtime-generated completion delivery remains allowed;
- list, search, send, and deliveries queries enforce the same visibility rules.
