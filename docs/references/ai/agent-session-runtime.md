---
description: Host/driver split for agent sessions — turn lifecycle, follow-up queue, resume tokens, and shared prompt materializer
sources:
  - src/main/ai/agentSession/AgentSessionRuntimeService.ts
  - src/main/ai/runtime/types.ts
  - src/main/ai/runtime/claudeCode
  - src/main/ai/runtime/pi
  - src/main/ai/runtime/dsh
  - src/main/ai/runtime/agentPrompt.ts
---

# Agent Session Runtime

## Purpose

Agent-session streams need a stable host for UI turns, persistence, live
follow-ups (steers), and recovery. The host must not know whether the
underlying agent uses a long-lived process, a websocket, one HTTP request
per turn, or Claude Code's SDK `query`.

The boundary is:

- `AgentSessionRuntimeService` owns Cherry's UI/session lifecycle.
- `AgentSessionRuntimeDriver` owns the concrete agent-session runtime lifecycle.

The built-in drivers are Claude Code, Pi, and DeepSeek Harness (DSH). Their
query/session transports, tool surfaces, approval gates, and resume formats are
driver internals behind the same host contract.

## Ownership

| Owner | Responsibility |
|---|---|
| `AgentChatContextProvider` | Validates the agent session, persists the user row (plus a pending assistant row on a fresh turn), and either starts a turn or enqueues a follow-up through the runtime. |
| `AgentSessionDeliveryService` | Owns durable cross-Session delivery admission, FIFO scheduling, recovery, finalization, quiescing, and deletion coordination. |
| `AgentSessionRuntimeService` | Owns one runtime entry per session: current UI turn, pending UI queue, runtime connection, latest resume token, terminal listeners, persistence, and idle timer. |
| `AgentSessionRuntimeDriver` | Connects to one concrete agent implementation and exposes `send`, serialized `reconcile`, optional `redirect` (mid-turn steer), `close`, and an event stream. |
| `AiStreamManager` | Keeps the normal topic stream contract: start a turn, attach a follow-up subscriber to a live turn, pause the current runtime turn, and start the next runtime turn. |
| `AiService.streamText()` | Routes `request.runtime.kind === 'agent-session'` to `AgentSessionRuntimeService.openTurnStream()` and rejects agent-session topics that do not carry runtime metadata. |
| Runtime drivers | Convert runtime-native events into the common event stream and map opaque resume tokens back into their SDK/session transport. |
| Usage capture | Each driver exposes provider-invocation capture according to its transport; gateway-backed calls use AiService middleware rather than a runtime aggregate. |
| Runtime timing | `AiStreamManager` owns the message clock. Drivers contribute provider/tool timing when their SDK exposes it; approval waits are captured independently from approval request to decision/abort. |

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
| `system.md` selects native vs custom base; Cherry append survives either choice | Claude maps into its preset/custom prompt, Pi uses system/append overrides, and DSH composes base plus append into its generated persona. |
| Common append text and block order | Claude uses the preset's `append`; Pi uses `appendSystemPromptOverride`; DSH places it in composition persona text. |
| Workspace instruction authority | Claude uses `AgentsMdLoader`; Pi permits native context files; DSH enables bounded workspace context. Physical placement differs while semantic precedence stays common. |
| Enabled managed skill content | Claude injects plugin/config representation; Pi uses `additionalSkillPaths`; DSH writes `skillDirs` into the generated composition. |
| Current workspace guarantee | Each driver supplies cwd/workspace context through its native base or the common custom-base compensation block. |
| Coding/runtime handbook and native tool snippets | Owned by each runtime's native base, never copied into the common materializer. |

Do not add Cherry policy directly to one driver. Extend the common materializer, pass any runtime-derived capability fact into it, and add integration assertions for every registered runtime. This module is main-process orchestration, not a cross-process contract, so it does not belong in `@shared`.

## Fresh turn

1. Renderer sends `ai.stream.open` for topic `agent-session:<sessionId>`.
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
steering is only valid after that turn's stream is `open`. Redirect also requires
both the current turn and incoming input to be interactive. Delivery, channel,
scheduled, and other headless-owned work cannot absorb or be absorbed by a steer;
it must wait for its own turn so attribution and authorization remain attached to
the work's provenance.

When a steer **is** injected mid-turn, the driver emits a `steer-boundary` just
before the model's post-steer assistant message. The host then **rolls** the
assistant row: it finalises the pre-steer parts as one row (A1a), opens a fresh
continuation row (A2), and replays the buffered post-steer chunks into A2 — so
the steer user message sorts between the two assistant rows instead of dangling
after the whole turn. `willContinueTopic()` keeps the topic stream alive across
the roll (and across a mid-flight compaction) so the continuation carries the
renderer listeners.
The source row's terminal event is marked `row-roll`; lifecycle consumers must
not treat it as completion of the work that continues in A2.

## Cross-Session delivery

Agent Sessions communicate through the same host-owned message and runtime path; provider
processes never connect to one another. A delivery is an ordinary `agent_session_message` in the
receiver Session plus Main-authored routing and lifecycle metadata. The database records work still
owed. `AgentSessionDeliveryService` schedules directly from durable `accepted` rows; delivery never
enters the runtime's process-local follow-up queue.

### Tool contract

Each `cherry-tools` instance receives its trusted `agentId` and `sessionId` from `settingsBuilder`
and exposes nine autonomy tools:

- `cron` — create, list, update, or remove scheduled Agent jobs;
- `notify` — send messages or supported workspace files through connected channels;
- `config` — inspect and manage the current Agent's own configuration and channels;
- `session_list` — deterministically enumerate visible Sessions and filter by Agent;
- `session_read` — page through one visible Session's turns, newest page first, using an opaque
  cursor to continue into older history;
- `session_search` — rank visible Sessions with BM25 over the existing trigram message FTS plus
  Session metadata, returning evidence snippets rather than adding an embedding dependency. Agent
  filters are applied before either search limit. The final limit counts distinct Sessions, each
  Session keeps its strongest message evidence, and `metadataMatches` identifies name/description
  hits instead of overloading an empty message-match list;
- `session_create` — atomically create a same-Agent Session plus its first completion request;
- `session_send` — send one-way or request an asynchronous terminal completion;
- `session_deliveries` — inspect incoming and outgoing request/result state.

`session_read` is available only from an interactive user turn after the runtime verifies that its
trusted current Session still belongs to the trusted Agent. Every call requires live user approval,
including when the Agent otherwise runs in Full Access mode. The requested target must be an
addressable Session: it must exist, belong to an Agent, and that Agent must not be soft-deleted;
knowing an orphaned, deleted-Agent, or missing Session id does not expose its messages. The default
page size is 10 and the accepted range is 1–100. Reads start at the newest page, return turns in
chronological order within that page, and expose an opaque `next_cursor` that walks into older
history. Tool output projects only text parts into `id`, `role`, `content`, and `createdAt`; it does
not expose the stored message payload or non-text parts.

`session_send` has one asynchronous contract:

```ts
type SessionSendInput = {
  target_session_id: string
  message: string
  reply?: 'none' | 'completion'
}
```

`reply: 'none'` is one-way. `reply: 'completion'` creates one frozen terminal result in the sender
Session. Every request owns one independent target turn; delivery never redirects into an active
turn and never enters the runtime's process-local follow-up queue. The tool returns after the
durable request reaches `accepted`; it never waits for scheduling or target execution.

`session_create` reuses the same completion-request path after creating the same-Agent Session. The
model is not a tool argument because Sessions use their owning Agent's model.

### Deliberate security ceiling

`session_send` and `session_create` always require a live per-call user approval because both start
another Agent Session turn. A headless delivery, channel turn, scheduled turn, or other execution
without an approval responder is denied before either tool runs. Runtime-generated completion
results do not call a model tool and route only to the immutable sender Session stored on the
accepted request.

This deliberately limits the first version to one user-approved delegation hop. A Session started
by a delivery cannot initiate another `session_send` or `session_create`; it can only finish its own
request and let the runtime return the result. The limit prevents unattended A -> B -> A loops and a
prompt-injected Agent from using a more privileged Agent as a confused deputy without introducing a
speculative ACL subsystem. Upgrade only when the product requires unattended multi-hop
collaboration; that upgrade must add an explicit Agent allowlist/delegation policy plus trusted trace
ancestry, depth/cycle checks, and a total-call/rate budget before relaxing the headless denial.

List, search, send, create, and delivery-query visibility share one authorization boundary. Channel,
scheduled, and delivery-triggered turns are denied in code; Task sub-agents may discover Sessions
but still require a live approval for delegation. Knowing a Session or message id never grants
access by itself. `session_list` pages only addressable Sessions and returns an opaque cursor.

### Durable row shape

The target Session id remains the message row's existing `sessionId`. Trusted sender/receiver IDs,
reply policy, optional display snapshots, result provenance, outcome, error, and status
timestamp live in the Main-authored `delivery` JSON. Names are display-only snapshots and never
participate in routing or authorization.

Only state used by queries, indexes, compare-and-set transitions, or constraints is promoted to a
regular column:

```text
delivery_status             accepted | delivering | consumed | failed
delivery_turn_ref           assistant placeholder id while delivering; NULL otherwise
delivery_in_reply_to        result -> request id; NULL for requests
delivery_sender_session_id  outgoing-delivery query key
```

Use plain indexes on `delivery_status` and `delivery_turn_ref`. Index
`(delivery_sender_session_id, created_at, id)` for the outgoing ledger. A nullable ordinary unique
index on `delivery_in_reply_to` guarantees at most one result per request because SQLite permits
multiple `NULL` values. A separate `deliveryKind` column is unnecessary:
`delivery_in_reply_to IS NULL` identifies a request, and non-NULL identifies a result.

The lifecycle is:

```text
accepted   durable intent committed; runtime has not acknowledged scheduling
delivering bound to one durable turn reference
consumed   target terminally processed the input; any required result exists
failed     permanent routing/admission failure; no automatic retry
```

SQLite `accepted` rows are the only delivery queue. `AgentSessionDeliveryService` owns scheduling,
state transitions, finalization, recovery, and shutdown coordination; `AgentSessionMessageService`
provides synchronous transaction primitives for the message table. Busy, write-quiesced, and
shutting-down targets remain `accepted` until a known wake event. A temporarily inaccessible
workspace also remains `accepted` instead of destroying durable intent; missing paths and permanent
permission failures are routing errors. Workspace probes are time-bounded so an unreachable mount
cannot hold backup quiescing indefinitely, and repeated checks share the same underlying non-abortable
filesystem probe until it settles. Filesystem availability has no reliable app event, so the lifecycle
owner runs a low-frequency recoverable-row sweep as a fallback in addition to ordinary
terminal/idle/quiesce-release kicks. Permanent routing
errors and unknown admission failures enter structured `failed` terminal state rather than retrying
forever.

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
rerun it without creating a second result. The Agent Session backend persists an empty terminal row when accumulation produced no final
snapshot; ordinary chat keeps skipping an empty successful reply. If live terminal persistence
throws, the Agent Session backend best-effort advances the placeholder from `pending` to `error`
before the generic terminal event runs. If that repair also fails transiently, the recoverable-row sweep retries it once neither the runtime,
a live stream, nor terminal persistence owns the placeholder. The runtime resume token remains
owned by the live CLI session rather than being cleared only in SQLite. Result dispatch remains
outside the transaction.

After asynchronous validation and while holding the target topic's dispatch lock, one synchronous
transaction persists the user row and pending assistant placeholder and CAS-claims
`accepted -> delivering` with `delivery_turn_ref = assistant.id`. A database CHECK enforces that
`delivering` has a non-null turn reference and every other state has a null reference. The
transaction rolls back all three writes when the CAS loses. Only after commit does the owner call
`beginTurn` / `AiStreamManager.send`, so crash recovery never mistakes an unowned turn for
redispatchable intent. Because `send()` installs its live stream before its final lifecycle callback,
a thrown callback is treated as post-handoff when `hasLiveStream(topicId)` is already true; only a
throw with no live stream is finalized as `TURN_START_FAILED`.

Validation captures the owning Agent's update timestamp. The claim transaction verifies both the
Session-to-Agent binding and that timestamp before writing either placeholder; a concurrent Agent
model/configuration edit leaves the request `accepted` and reruns validation with the new state.
One kick performs at most one immediate revalidation; a deterministic mismatch then yields so
backup and shutdown drains cannot be held by a synchronous retry loop. Legacy `cherry-claw` Agent
rows compare using their effective `claude-code` runtime type.

Session deletion is a mixed operation and therefore uses the IpcApi
`ai.agent.session.delete`, not DataApi DELETE. `AgentSessionDeliveryService` calls the data service
for one transaction that creates exact failure results before cascading target rows, then closes the
deleted Sessions' runtimes before kicking only those returned result rows. A caller that has already
been deleted cannot receive a result; that terminal routing failure is recorded rather than retried.

### Recovery

During lifecycle initialization the delivery owner scans `accepted` and `delivering` rows in
`(createdAt, id)` order. Accepted rows already are the queue and remain untouched until the
system-wide ready hook kicks them through the per-topic dispatch lock. For `delivering`, inspect the
indexed `delivery_turn_ref`:

- placeholder absent — mark `failed(DELIVERY_TURN_DELETED)` and never replay the request; absence is
  evidence of deletion, not proof that execution never started;
- placeholder still `pending` — execution may already have produced external side effects;
  terminalize interrupted parts, discard the Session resume token, finalize `interrupted`, and do
  not rerun the Agent;
- placeholder terminal — run only the idempotent finalizer.

The generic pending-assistant sweep excludes rows referenced by `delivery_turn_ref`; therefore its
write set and delivery recovery's write set are disjoint and their relative initialization order is
irrelevant. Delivery kicks, deletion handlers, and terminal finalization are tracked by the owner;
`onStop` suppresses new kicks and joins admitted handoffs. Backup pause/drain includes the delivery
owner alongside the stream manager and runtime.

The system guarantees durable accepted intent and, for each completion request, exactly one durable
result row once a terminal outcome is known. Scheduling is recoverable, but arbitrary model/tool
execution is not exactly-once. There is no automatic replay after an ambiguous in-flight crash,
there is no finite result-latency bound while the caller is blocked on interaction, and caller-side
resubmission without a future idempotency key may create a distinct request.

The Claude Code adapter prepends a versioned delivery envelope to the current SDK user input. Stable
delivery/content markers carry an unpredictable per-materialization boundary and an explicit notice
that only the metadata is host-authored while the body is untrusted. Literal `system-reminder` tags
are defanged without otherwise rewriting model-authored Unicode content. The envelope is
informational context, not authority: database metadata remains the source of truth, and the random
boundary prevents model text that imitates an envelope from changing trusted routing fields.

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

### Pi code mode

Pi exposes only `read`, `write`, `edit`, and `bash` directly. Its complete bridged
MCP catalog, including Cherry autonomy tools, is exposed through four native custom tools:

- `tool_search` ranks tool names and descriptions with BM25 and returns each match as a
  TypeScript declaration for `tools.invoke(name, params)`. The declarations are
  model guidance; they are not compiled or type-checked.
- `tool_describe` returns the complete description and TypeScript declaration for one
  discovered tool.
- `tool_call` calls one discovered tool, applying that target tool's live disabled-tool
  and approval policy before execution.
- `tool_exec` runs JavaScript in the existing worker-thread executor and routes
  `tools.invoke` calls back to the Pi MCP definitions. The outer `tool_exec` call
  always uses Pi's approval flow (except the explicit `bypassPermissions` mode),
  and every nested call re-enters the same live permission/approval policy. Nested
  approvals are presented one at a time because the outer Pi tool part carries one
  active approval card; accepted calls may still execute concurrently.

This executor is an orchestration boundary, not a security sandbox:
`worker_threads` isolates scheduling but retains the app's Node.js authority.
Move it to a capability-isolated executor before allowing untrusted code without
an outer approval prompt. Pi's native file and shell tools are not in the code-mode
catalog; `read`, `write`, `edit`, and `bash` remain direct tools with their existing
path and command policy.

## DSH driver boundary

`DshRuntimeDriver` launches the bundled DeepSeek Harness through
`@deepseek-ai/dsh-sdk-client`. `DshRuntimeConnection` generates a
session-specific composition under the centralized DSH paths, injects the
resolved provider/model configuration, and connects the harness process to a
local `DshBridgeServer`.

The bridge is the Cherry capability boundary. It projects Cherry-owned and
selected MCP tools into DSH names, applies live disabled-tool and permission
policy, routes approval requests through the shared registry, and forwards
subagent/background-flow events into the host event model. DSH-native built-ins
remain described by the shared `dshBuiltinTools` catalog; the driver does not
reuse the AI SDK `ToolRegistry`.

The generated composition receives the common Agent prompt, bounded workspace
context, managed skill directories, and a generation-specific bridge socket and
token. Connection materialization snapshots provider/model/tool facts before
and after startup and fails closed if they change. Resume tokens are validated
before use and remain opaque to `AgentSessionRuntimeService`.

`DshStreamAdapter` maps session events, usage, retries, compaction, plan-mode,
and terminal reasons into `AgentRuntimeEvent`s. DSH child-session lifecycle is
coordinated separately so nested content is either attached to the current host
turn or persisted as background flow without corrupting the main transcript.

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
Repeated `closeSession()` calls join the in-flight close; if a replacement entry was created meanwhile,
its close is chained behind the prior one so callers wait for every connection generation to settle.
An immediate retry may create its entry while that close is still draining, but it cannot connect until
the predecessor has closed. Teardown also joins an in-flight `driver.connect()` and closes any stale
connection it produces before releasing the successor; the predecessor's observed resume token is handed
to that successor directly.

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

For backup restore (#16849) the runtime and delivery owner expose `pause(reason?): Disposable` +
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
write and `startRuntimeTurn` handoff — plus detached-flow finalizers that may still persist message
parts and runtime close barriers that may still flush external state after their entry is removed.
The resulting stream writes belong to `AiStreamManager`'s drain. This is distinct from the BaseService
lifecycle pause and never touches service state.
`AgentSessionDeliveryService` suppresses accepted-row kicks while a
hold is live, tracks validation/claim/send handoffs and deletion orchestration in its drain set,
rechecks the hold and target busy/live state after asynchronous validation before any transaction, then re-kicks
suppressed target Sessions when the final hold releases. Runtime `closeSession()` also emits the
generic idle event so accepted work blocked by a stopped turn is not stranded.
Per-Session kicks use a rerun latch: an idle/terminal wake arriving while the previous single-flight
kick unwinds is replayed after ownership releases rather than being dropped as a duplicate.

## Verification

Focused tests:

- `src/main/ai/streamManager/context/__tests__/AgentChatContextProvider.test.ts`
- `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`
- `src/main/ai/agentSession/__tests__/AgentSessionDeliveryService.test.ts`
- `src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`
- `src/main/ai/__tests__/AiService.test.ts`
- `src/main/ai/runtime/claudeCode/__tests__/streamAdapter.test.ts`
- `src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeWarmQueryManager.test.ts`
- `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts`
- `src/main/ai/runtime/dsh/DshRuntimeDriver.test.ts`
- `src/main/ai/runtime/dsh/__tests__/DshRuntimeConnection.trace.test.ts`

Cross-Session delivery acceptance tests additionally pin these crash and security boundaries:

- crash after terminal persistence but before result finalization creates exactly one result after
  recovery and never reruns the target turn;
- a `pending` assistant placeholder at recovery produces an `interrupted` result without replaying
  model or tool execution;
- recovery of a completion request while the target Session is busy cannot bind another turn's
  terminal output;
- write quiesce and target-busy gates leave delivery `accepted` until their explicit wake event;
- repeated finalization returns the existing result, while the unique `delivery_in_reply_to` index
  prevents a second result row;
- deleting a target Session first creates failure results for pending completion requests;
- deleting an accepted request cannot leave an in-memory entry because delivery has no runtime FIFO;
- a missing `delivery_turn_ref` target fails recovery without replaying model/tool work;
- interactive `session_send` and `session_create` request approval, while headless calls are denied
  and runtime-generated completion delivery remains allowed;
- concurrent dispatch attempts for one durable message atomically persist one placeholder plus one
  CAS owner before producing one send;
- list, search, send, and deliveries queries enforce the same visibility rules.
