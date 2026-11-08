# Claude Code agent runtime

`createClaudeCodeRuntime` adapts Claude Agent SDK 0.3.311 to the common
[runtime contract](../agent-runtime/README.md). A runtime owns one configured
backend and one Query per native root session. Each Query has one event reader;
root and child accesses subscribe to its independently normalized threads.
This package contains no Electron, product database, rendering, or tool policy.

## Access and ownership

Pass a stable `backendId`, an absolute `configDir`, and optionally a `load(root)`
callback returning materialized native options for a saved root. The host owns
the backend namespace and must not create competing runtimes over the same files.
`onError` forwards diagnostics to the host's logger. No credentials are logged.

`create(options)` requires an absolute `cwd` and reserves the native session ID
before starting execution. Native permission mode defaults to `default`; explicit
modes and native hooks/callbacks pass through. `open(thread)` validates the backend
and existing native storage. Opening and observing do not run a model. The first
root submission starts or resumes its Query. Concurrent opens share that owner.

The host may supply a reserved `sessionId` to `create`. `claude.start()` initializes
the connection without model input, optionally taking exclusive ownership of a
matching SDK `WarmQuery` and its process-exit Promise. The host must match its
captured configuration and credentials. Command discovery and
permission-mode updates use typed native methods on `claude`, without exposing
the Query iterator to a second reader.

`claudeThread(backendId, sessionId, agentId?)` constructs a reference from established
native identity. Hosts store the opaque `Thread.id`; they do not parse its encoding.
A child is a native root session plus stable agent ID, independent of run ID and
tool invocation. Its relationship retains evidenced creation origin across continuation and archive
recovery. `claude.openChild(toolCallId, signal?)` returns that relation and an independently releasable
access, waiting for known native creation and rejecting unknown/ambiguous evidence. It starts no work.
Child accesses have no common input or interrupt operation.

Stopping a subscription or releasing a handle only detaches that access. A parent
result does not end child observation. `shutdown()` closes admission, asks the SDK
to close, joins its event reader and subprocess exit, and reconciles available
archives before ending feeds. An unconfirmed exit returns `unknown` and retains
the owner; retry shutdown after the host resolves process termination. Handles
may still read archives after shutdown until released. Native history is not deleted.

## Context usage

Common `contextUsage()` reads the existing Query's native context report without starting a
process or sending model input. Root readings use the authoritative gateway model capacity when
provided, otherwise the native result's model capacity. Before either is available the reading
is unknown. A native compact threshold is never substituted for the full window. Categories and
resources are estimates; partial coverage and missing reserve/free counts remain explicit.
Root stream input usage is marked `last-request` and excludes output and cumulative billing.
Child controls are unsupported because the SDK exposes no child-scoped context report.
Stream deltas keep the active response model's identity; an unknown window stays unknown
instead of inheriting the configured model's capacity. Successful and failed context reads
publish their current result to existing observers and future snapshots. A read superseded
by a newer read, model change, reset or shutdown cannot overwrite that newer state.

## Input and control

Root `input.submit` supports `steer` and `follow-up`, mapped to native `next` and
`later` priority. Busy `reject` is unsupported because the SDK exposes no atomic
rejection operation. Steering can become a later turn when no tool boundary remains.
Native Agent/SendMessage own child continuation; no direct child send is fabricated.

Each logical input receives a native UUID. Reusing an input ID on the same owner
is rejected; this is not durable deduplication. The submit receipt initially proves
only `dispatch-started`. Correlated native request membership or output establishes placement; the native result
establishes completion, failure, interruption, or an unanswered outcome. Several
inputs can share one response. Process loss leaves uncertain delivery uncompleted
and never triggers automatic resubmission.

Slash commands use native input. Correlated local completion adds `locally-handled`;
uncorrelated command output is not assigned to the oldest pending input. On reset,
old root access becomes unwritable. A new thread is bound only from authoritative
native init/result session identity, using the existing Query. The reset event's
`new_conversation_id` is not a resume locator. `/clear` settles its original input
even when its result names the new session.

Root `interrupt()` leaves native queued inputs intact and records `still_queued`
receipts. `claude.stopTask(taskId)` requests a stop only for a task known to this
owner; native task events establish its outcome. Neither method claims to shut
down all session work. Host Stop policy remains a desktop concern.

## Observation and archive

Use either common `observe` or typed `claude.observe` for a projection writer.
Typed batches pair normalized events with native control facts, completed invocation evidence,
the exact native payload and source retractions. Rich blocks, thinking signatures, usage, reset and local-command
metadata remain native types. The adapter never introduces SDK types into the
common package. `ClaudeFeed` uses `ThreadFeed` for normalized state and bounds
delivery of paired batches. Baseline and recovery are internal delivery modes; aliases,
retractions and live provenance are captured together. Batch state exposes captured `aborted`;
`claude.state()` exposes current `active`. Background occupancy stays in private control state. Initial baseline includes current background
occupancy and pending result origins without replaying historical completion or charges.
`background-results` tracks child-agent runs by native run ID and current triggering tool-use ID;
a continuation does not reuse its creation call. Task notifications associate autonomous generation
with those calls. Empty membership alone does not drain a result: its notification, parent answer
and native idle barrier must finish. Resident commands retain occupancy without becoming pending
child-agent results. Overflow recovery retains unseen control
and invocation facts after their matching body; an unrecoverable backlog reports a gap and closes.
Slow or failing consumers cannot block native execution. After stopping production, hosts await
`Observation.drain()` before final archive persistence, then detach and release. `runtime.settled()`
joins native input and background occupancy without closing the SDK; the desktop backup barrier
then joins observation and child archive writes. The repository's SDK 0.3.311 patch forwards existing
host-only `session_state_changed` events to the iterator, preserving SDK state bookkeeping and CLI
behavior. Native idle releases background occupancy; a missing idle fact cannot become successful
quiescence. Confirmed shutdown joins the source reader and final observation delivery. `stop()` alone
discards queued delivery and is not a write barrier.

The typed feed also includes native `command_lifecycle` events, which the pinned
SDK emits but omits from its `SDKMessage` declaration. `queued` proves native
admission; `started` proves dispatch into native handling, including local commands.
Neither alone proves model placement. A typed-prompt turn stamps reply correlation
once, so a later folded input can be absent from the reply's UUID list.
Native `status: requesting` carries the request's current input UUIDs before streamed content;
the adapter validates this field, omitted from the pinned SDK status declaration, to emit
`input-boundary` before the next reply's body and charges. Main never infers placement from
`started`. Input outcomes precede the corresponding terminal result batch.
`ClaudeControlState` owns native lifecycle, task receipts, autonomous work and compaction semantics.
Control payloads reuse SDK message types; only interpreted state, task/tool correlation and observation
timestamps are adapter-owned fields. Main maps native payloads to product labels and display fields.
The adapter exposes `isApiErrorMessage: true` on typed native evidence only when
proved by a live SDK rejection or the matching archived assistant UUID's native
boolean marker. The SDK's normalized history omits that marker, so recovery reads
it from the already imported raw native records. Baseline and overflow recovery
retain the fact. Main owns rejection wording; ordinary text quoting an API error
is not rejection evidence.
`ClaudeInvocations` aggregates SDK usage by native response identity before fanout, retaining SDK
usage fields and types. A task notification finalizes only the completed response on its
`tool_use_id` lane; a task update without that correlation cannot finalize an invocation.
Root results leave child responses pending, and incomplete initial usage is never charged.
Main converts token counts to product usage and owns frozen
pricing, product attribution and idempotent persistence; Gateway remains the sole capture path for
Gateway requests. The display decorator owns only MCP presentation, reminders and thinking timing.

Committed message IDs use transcript UUIDs; ordered SDK parts retain their native blocks.
Provisional root messages carry `replaces` when committed; distinct UUIDs sharing an API response ID remain
distinct. Child output has native complete-block granularity. Aborted content stays
partial. Explicit retractions are retained in live snapshots and archives so replay
cannot revive removed sources. A newer task run cannot be ended by an older run's
late event. Missing parent evidence leaves relationships unresolved.

`claude.archive()` returns normalized SDK messages (`content`), legacy part mappings and explicit
retractions. Raw native messages and committed-source membership remain internal. SDK history APIs and native export run in an isolated
worker with the backend's configuration environment; the caller's environment is
unchanged. Live events are buffered during reconciliation and applied afterward.
Compaction selects a new model context without deleting previously observed product
content. Missing native files return an error instead of a writable replacement.
`claude.archive({ refresh: false })` captures already observed committed content
without triggering another observation from inside a projection writer. Default archive
refresh still reads the selected native view. Permission denial is applied to native tool parts and
survives out-of-order assistant messages and archive refresh.
The adapter preserves signatures, files, citations and raw tool outputs in SDK parts/metadata.
The desktop adds display metadata and persists source mappings/retractions with its checkpoint.
`legacy` maps prior UUID/block identities to proven whole-message part positions.

Live content uses SDK discriminated unions; block, stream-delta and message-event
handling is checked exhaustively against the pinned SDK. Archive `SessionMessage.message`
is `unknown` in the SDK: its decoder validates the consumed fields without casting
history to a complete live message. Unknown archive blocks remain in the native
view and cannot alter normalized tool calls merely by carrying a `tool_use_id`. `control.test.ts`
classifies every pinned SDK message variant and checks that advisory native-only events cannot
settle a turn; adding a variant requires an explicit owning contract.

Streamed signatures, redacted-thinking ciphertext, citations and MCP source metadata
survive in late-observer snapshots before a complete message arrives. Tool results
commit with their transcript UUID for retraction; both explicit `is_error` and native
provider error blocks produce failed tool state with their raw output retained.
Compaction blocks, container uploads, search-result context and embedded document
sources stay native-only, as do advisory events without a common runtime meaning.
The host receives these through `claude.observe`; the adapter does not invent display
parts or completion signals from them.

## Verification and desktop migration

```sh
pnpm --filter @cherrystudio/agent-runtime-claude-code build
pnpm --filter @cherrystudio/agent-runtime-claude-code typecheck
pnpm test:agent-runtime-claude-code packages/agent-runtime-claude-code/tests/runtime.test.ts packages/agent-runtime-claude-code/tests/observation.test.ts packages/agent-runtime-claude-code/tests/projection.test.ts
```

Runtime tests call the public package using the real SDK, CLI, native Agent and
SendMessage tools, isolated session files, and a scripted local Messages endpoint.
Wire tests use the real SDK transport with controlled native frames to reproduce
retractions, late runs, delivery gaps and consumer failures. Neither is a real-model
or Electron acceptance test.

This is the C1 package layer of the
[Claude migration Spec](../../.agents/notes/proposed/architecture/2026-10-27-agent-runtime-claude-code.md).
The desktop driver uses this package for execution and observation. Cherry owns
desktop contexts, approval/question callbacks, provider routes, prewarm ownership,
billing, fork/edit, and shared message projections; child content has its own writer.
