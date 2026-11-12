# Pi Durable agent runtime

`createPiDurableRuntime` adapts Pi Durable 1.5.2 to the
[agent runtime contracts](../agent-runtime/README.md). It owns one native `Harness`,
its storage, conversation views, and commit observation. It does not implement
another scheduler, submission queue, or agent loop. The
[desktop driver](../../src/main/ai/runtime/piDurable/README.md) supplies Cherry's
storage bindings, gateway models and host services.

## Configuration and ownership

The factory takes a stable `backendId`, an `openStorage()` factory, native typed
`HarnessOptions` (models, registry, settings, environment), and optional `onError`.
Storage must belong exclusively to this runtime. The host supplies its path and
ensures only one writer uses that namespace. Native `harness.onReport` remains
available for native diagnostics; `onError` receives adapter/observer failures.

`create(options)` takes native `ConversationCreateOptions`. `open(ref)` only opens
an existing conversation in this backend. Concurrent accesses share one normalized
source. `release()` stops that access's subscriptions; it does not close the shared
Harness or cancel work. `shutdown()` seals all accesses, closes the Harness and
storage, and joins tracked calls. Unfinished durable tasks are not marked cancelled.
It captures committed archives after native execution has quiesced and before storage
closes; retained accesses can flush these archives until `release()`.
Shared behavior drains native input admission before ending local consumption waits.
Ending a wait does not cancel or resend an admitted input; a queued steer remains in
native storage for recovery. Unexpected native closure seals accesses and closes
observation feeds immediately, even while task cleanup is still running. Normal shutdown
still drains admitted relation reads and their final facts before closing feeds.

`resume()` enables the entire Harness scheduler. Reading with `open` or `observe` does not resume it. Native `submit` and `interrupt` can resume the entire
Harness, including other conversations. Without shared behavior, `interrupt()` uses native ordinary-scope
abort: queued inputs and owned non-background work are included; queued writes and
background subtrees are not. These effects are not application-wide cancellation.

## Input and output

Every Durable access provides `input.submit(input)`. Busy rejection comes from native
`ConversationBusy`; uncertain failures return `unknown`. Once native admission returns, a failed
status read cannot erase the acknowledged receipt. Inputs retain their logical InputId in native
entry metadata, so observations recover their placement and outcome after reopening. External
native submissions may lack that logical ID. The adapter exposes no separate host deduplication,
lookup or retraction API; unknown admission is reconciled from captured facts without resubmitting.

`whenBusy: 'steer'` delivers input at the next native input boundary. If the current
run finishes normally before taking it, the input starts a subsequent run. `follow-up`
waits for the final boundary. Both policies start a run when the conversation is idle;
normal completion does not discard accepted input. Explicit interruption still follows
the native cancellation scope. Read captured input facts to distinguish
acceptance from placement and completion.

Several inputs can share a native answer. Native `done` alone is insufficient: Durable also uses it for truncated output
and tool-only termination. The adapter reads the actual assistant stop reason before reporting
`completed`; truncation becomes `unanswered` with `output-truncated`. Native aborted submissions
map to `aborted`, known model/task failures to `failed`, and other unanswered reasons remain
`unanswered`. A late status read cannot downgrade a known terminal state. These reads do not
enable the scheduler.

`durable.observe` captures content, inputs, aliases, live provenance, `backgroundResults` and foreground
completion from one native `ConversationView` revision. Completion includes the last visible committed entry ID for desktop fork checkpoints. Retained native entries and tool tasks
supply result origins; continuation records identify the current triggering call. Pending results
include undelivered reports and unfinished notification generation, including the gap before it starts.
An unknown origin is reported as unknown, never as confirmed drainage. The Pi Durable dependency patch retains atomic observer attachment with storage reads,
and complete active-context views instead of the default bounded
transcript window. Durable receipts use native `observeCommits`; synchronous view observations supply the
matching content, while the public coalesced watch is not used for completion. Native 1.5 publishes
the view before the commit observer microtask and publishes successive stored commits separately.
Preview delivery follows that receipt microtask and cannot establish completion.
Deferred in-memory progress is a preview without a durable revision; only stored commits can
confirm foreground completion. Native progress may remain unpersisted for up to its configured
`persistWithinMs` interval (1,000 ms by default); archives contain stored entries only. Reopen reads all submission
facts, including placed native-only inputs. Completion stays pending during admission, unresolved input,
foreground work or compaction, and carries terminal inputs after their content. Revision and pending state stay private to the projection.
A confirmed rejection releases only its temporary admission hold; unknown admission remains unresolved.
Initial observation never replays earlier completion. A generation preview already active at attachment remains live for its product consumer; only the committed prefix is historical. A returning preview receives a fresh local identity even when a resumed native task repeats its attempt number. Slow observers retain terminal batches through
recovery; final persistence must await `Observation.drain()` after native production stops.
`runtime.settled()` joins admitted submissions, all native tasks including background work,
and tracked relation delivery without closing storage. Shutdown completes admitted relation reads
before closing storage and delivers their facts before closing feeds. The desktop backup barrier
joins settlement before draining observation callbacks and writing archives.

Observations normalize committed `ConversationView` snapshots, live assistant
partials, tool calls/results, and retained live tool output. These snapshots describe the current
view; `archive()` supplies committed history. Persistent entries use native entry IDs;
live previews use an internal source namespace. The adapter associates a disappearing
preview only with a unique later entry produced by its native task. Where that
association is not proven, it emits `gap: mapping-reset` and a replacing snapshot.
Consumers must not merge these by text. Ordered SDK message parts preserve text, reasoning,
images and tool identity. Preliminary tool output updates the calling message even after its
assistant entry is committed; a final result clears the preliminary state.

`archive()` reads committed, conversation-owned history, including entries before
reset and compaction. Inherited fork entries are excluded so a child archive does
not import its parent's messages. Pagination is bounded by the head captured when
the read begins; appends after that head belong to a later read. It neither resumes
the Harness nor includes live previews. `messages` contains SDK message values. `aliases` maps committed message IDs to proven
preview IDs; tool results update their calling message instead of creating a separate row.
`legacy` identifies old item-to-part associations using native entry evidence for host checkpoints. These
aliases are local to the open runtime; reopening retains committed IDs and starts
with no preview aliases. The host owns persistent product-message associations.

Native ownership records expose `Subagent` relationships through `snapshot.subagents`
and `subagent.upsert`. Parent attachment queries all pages of immediately owned children;
commit observation delivers subsequent creations. Completed children remain discoverable after
restart, with or without shared behavior. The adapter keeps no separate relationship cache or
task graph watch. Relationship IDs use the native child
conversation ID within the parent, so subsequent inputs retain the same relationship.
They carry evidenced creation `origin` and no assignment completion status. Behavior lineage preserves
the original creation call across continuation; cold recovery also reads stored child relationships.
`durable.openChild(toolCallId, signal?)` waits for a known creation and returns its relationship and
access together. It queries native ownership before resolving access, so delayed relation delivery
cannot make a committed child appear unavailable. `durable.relation()` reads the child's original
ownership and creation evidence on demand, including before its parent has opened. Unknown or
ambiguous evidence returns an explicit error. Open and observe a child
separately; parent output does not recursively contain it.

Without shared behavior, child access can submit further input after the parent access is released. Direct
conversation input does not create a reporter task or another parent result. The
raw adapter never delivers child results to the parent; native tasks own that behavior.

`durable.compact()` waits for the native task and its summary write to settle.
Its receipt distinguishes a committed summary from a no-op (including a declined
summary); a failed or unplaced summary is never reported as committed.

Input deltas publish changed evidence only. Internal status reads do not emit another
`input.changed` or wake a reconciliation loop. Main consumes the captured completion batch instead
of polling retained inputs or deriving completion from idle activity.

## Shared behavior

The optional `behavior` factory option installs `agent-behavior` with Cherry's
`HostPorts` and a `configureChild({ thread, parent, modelKey })` model-binding callback. Native tools, transactional
records, hooks, memo, jobs and waits implement the harness ports. Product rules remain
in `agent-behavior`; this adapter contains no second subagent or goal policy engine.

Managed child input calls the shared `messageSubagent` entry, so background continuation
keeps the native child identity and creates the shared result job. Root `/goal` input
uses the shared command entry. Explicit root `interrupt()` records user stop before
cancelling; child interruption follows its current shared ownership. Opening installs
model bindings and runs `onOpen` before scheduler resume. Desktop hosts can select owned conversations and rebind root configuration before this recovery. Inherited model context remains visible, while behavior authority and summary charges come only from conversation-owned records. That policy stops interrupted
background children and disarms goals; ordinary unfinished root tasks can resume.

Compaction captures the behavior history before summarizing. The native dependency patch preserves
opaque summary metadata on the compaction entry, including the keyed usage record returned by the
shared lifecycle. Task memos expire at completion and are not the accounting archive. Reopening
projects each stored summary charge once; a compaction during a child run retains that run's identity.

Tool-result gates transform contiguous text spans and retain their positions among images. Native
structured output, UI details and other result fields survive the transformation.

The native dependency patch adds `runId` to consumed submissions and assistant entries.
It names the first generation task and survives tool/model handovers within that run.
Queued input acquires its run only when consumed. A late steer can therefore belong to
a later run without `onlyInRun` or a conditional-admission restriction. Usage, answers
and targeted stop read that native identity; stopping an older run cannot stop its successor.
A starting input also retains the behavior run reservation in its native entry. The adapter
reconstructs skipped numbers with zero usage, so stopping a child before its first input
does not shift the identity of its next run. Reservations never restrict steer admission.

Common `contextUsage()` uses the patched native `Conversation.contextUsage()` API. It reads
an immutable committed context range, the resolved model, and the native compaction estimator
without resuming work or evaluating generation hooks. Partial categories describe that committed
context; deferred tools remain outside occupancy. Native compaction settings remain internal. Prepared sections retain resource provenance with the committed system entries;
identity files, skill catalog entries and tool schemas expose individual estimates. MCP origins come
from tool registration, including codemode-only tools listed as deferred. Reads never rerender sections
or reload files. These partial estimates are separate from native billable usage records.

The runtime `durable.commit` facet shares the existing native mutation line; desktop fork operations retain the backend while using it. The thread `durable` facet exposes native configuration, compaction, behavior facts,
provider session identity and tool-call resolution for the desktop adapter. These stay
outside the harness-neutral Runtime contract. `onInputPlaced(inputId, thread)` runs synchronously at
native placement so the host reserves input attribution before the next model request; native-only
input may report an undefined logical ID.

Declared differences in the shared contract suite:

- Durable never invokes `ContextFilter`: pending input has not entered history. Two
  context-filter cases are skipped; the request cap is enforced by the native model wrapper.
- A completed foreground child still belongs to its original native tool task. Independent
  background continuation is rejected before writing run records or report jobs. One
  foreground-continuation case is skipped; there is no implicit fork or id forwarding.
- Desktop Fork and noninitial Edit and resend use same-storage ownerless native forks. First-input edits start a fresh context. File rewind and `vcc_recall` remain unavailable.

## Validation

Offline tests use the native faux provider and native Memory/Node SQLite storage:

```sh
pnpm --filter @cherrystudio/agent-runtime build
pnpm test:agent-runtime-pi-durable packages/agent-runtime-pi-durable/tests/behaviorContract.test.ts packages/agent-runtime-pi-durable/tests/runtime.test.ts packages/agent-runtime-pi-durable/tests/runMetadata.test.ts packages/agent-runtime-pi-durable/tests/projection.test.ts
pnpm --filter @cherrystudio/agent-runtime-pi-durable typecheck
```

The child test covers continued conversation, busy rejection, steering, independent
observation after release, stable relationship identity, and unchanged parent output.
`relations.test.ts` covers paginated ownership, concurrent initial discovery, read retry,
independent cancellation, native failure, scoped lookups and blocked relation delivery at settlement/shutdown.
It also checks that fatal storage failure reaches observers while tool cleanup is blocked.
`shutdown.test.ts` closes a running shared-behavior child with a queued steer and reopens
SQLite to verify that the original input remains queued exactly once.
Archive tests cover pagination, reset, fork ownership and stable identities after
SQLite reopen. Projection tests cover repeated text, ambiguous coalesced frames,
retries and tool progress. Shared behavior cases exercise native transactions, goal and
child ownership, stop, delivery, approval and reopen; run-metadata tests distinguish
same-run steering from late continuation. SQLite tests close and reopen an orderly
runtime; they do not prove process-kill recovery or exactly-once external side effects.
Desktop and live-provider acceptance are separate from these package tests.

## Nested tool evidence

Nested calls project onto their owning assistant message using native IDs and parent
edges. Native session records retain executed arguments, terminal state and bounded
results independently of the outer script outcome. Archive projection reads those
records without executing tools. Missing legacy or over-budget payloads remain
explicitly absent; complete successful built-in artifact declarations can render
through the same tool mapping as direct calls.
