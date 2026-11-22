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
Harness or cancel work. Releasing a conversation's last access unloads it: the adapter
detaches its native view and drops its loaded history, and a later `open` loads it again.
When an unloaded child receives input, its nearest loaded ancestor publishes
`subagent.upsert` so hosts can observe it again. `shutdown()` seals all accesses, closes the Harness and
storage, and joins tracked calls. Unfinished durable tasks are not marked cancelled.
It captures committed archives after native execution has quiesced and before storage
closes; retained accesses can flush these archives until `release()`.
Shared behavior drains native input admission before ending local consumption waits.
Ending a wait does not cancel or resend an admitted input; a queued steer remains in
native storage for recovery. The production close path has no behavior callback and skips the
conversation scan used for custom close callbacks. Unexpected native closure seals accesses and closes
observation feeds immediately, even while task cleanup is still running. Normal shutdown
still drains admitted relation reads and their final facts before closing feeds.

`resume()` enables the entire Harness scheduler. Reading with `open` or `observe` does not resume it. Native `submit` and `interrupt` can resume the entire
Harness, including other conversations. Without shared behavior, `interrupt()` uses native ordinary-scope
abort: queued inputs and owned non-background work are included; queued writes and
background subtrees are not. These effects are not application-wide cancellation.

Pi Durable installs tool approval and offload through native ToolTask hooks. Approval grants reuse the
existing task memo key, and output offload preserves non-text segments and structured tool results.

## Input and output

Every Durable access provides `input.submit(input)`. Before command routing or input submission,
the desktop may call `durable.initializeContext(text)` to admit initial model-only reference
history as a passive native write. The native request ID makes repeated initialization
idempotent across reopening. It starts no model run and is excluded from product projections
and behavior-authorizing user history, while ordinary and autonomous model requests see it.
Busy rejection comes from native
`ConversationBusy`; uncertain failures return `unknown`. Ordinary root submission uses native ownership and skips the behavior ledger. Managed child
submission resolves its stored origin and uses the existing child admission rules. Once native admission returns, a failed
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

Committed model failures retain their cause in `RuntimeMessage.metadata.error`, including responses without text.
Each attempt remains in history after later retries. Input outcomes come from native submission and run results,
independently of these message-local errors. Live observations and archive reads use the same projection.

`durable.observe` captures content, inputs, aliases, live provenance, `backgroundResults` and foreground
completion from one native `ConversationView` revision. Completion includes the last visible committed entry ID for desktop fork checkpoints. A history fold of the lineage's entries and tool
tasks, fed by the opening scan and by commit notifications, supplies result origins without retaining
entry bodies; continuation records identify the current triggering call. Pending results
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
The desktop child status read uses the native live run, inbox and latest generation outcome in one transaction.
A confirmed rejection releases only its temporary admission hold; unknown admission remains unresolved.
Initial observation never replays earlier completion. A generation preview already active at attachment remains live for its product consumer; committed output after the unique logical user-input boundary of an unfinished placed input also remains live. Earlier answers, queued inputs and ambiguous boundaries remain historical. A returning preview receives a fresh local identity even when a resumed native task repeats its attempt number. State-only reads and updates use `ThreadFeed.state`. Native views append the same entry records, so
the projection keeps its committed messages frozen and projects only appended entries; a later tool
result or live progress copies only the message it changes. A view that does not extend the previous
entries, such as after compaction, rebuilds once. Unchanged messages keep their identity across
snapshots. An observation starts with a snapshot, and the projection publishes another only after a
mapping reset and when a run starts, so an observer receives the run's inputs and activity in one frame;
a run end publishes `activity.changed`. Every other update publishes `message.upsert`,
`message.remove` and `input.changed` for what changed. A committed answer replaces its preview through
`replaces`. When an update's changes cannot reproduce the new order, it publishes a snapshot instead.
Completion rides the update's last frame, or `activity.changed` when nothing else changed.
Slow observers retain terminal batches through bounded recovery; final persistence must
await `Observation.drain()` after native production stops.
`runtime.settled()` joins admitted submissions, all native tasks including background work,
and tracked relation delivery without closing storage. Shutdown completes admitted relation reads
before closing storage and delivers their facts before closing feeds. The desktop backup barrier
joins settlement before draining observation callbacks and writing archives.

Observations normalize committed `ConversationView` revisions, live assistant
partials, tool calls/results, and retained live tool output. Replaying them describes the current
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
the read begins; appends after that head belong to a later read. A loaded conversation
keeps its sealed archive projection, so later reads fold only newer committed entries and
return immutable messages; unloading drops it. It neither resumes
the Harness nor includes live previews. `messages` contains SDK message values. `aliases` maps committed message IDs to proven
preview IDs; tool results update their calling message instead of creating a separate row.
`legacy` identifies old item-to-part associations using native entry evidence for host checkpoints. These
aliases are local to the open runtime; reopening retains committed IDs and starts
with no preview aliases. The host owns persistent product-message associations.

Native ownership records expose `Subagent` relationships through `snapshot.subagents`
and `subagent.upsert`. Parent attachment queries all pages of immediately owned children;
commit observation delivers subsequent creations. Completed children remain discoverable after
restart, with or without shared behavior. A child's creation commit writes its only origin
record, so origin lookups stop there and keep the result; the adapter keeps no other relationship
cache or task graph watch. Relationship IDs use the native child
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

The optional `behavior` factory option takes Cherry's `HostPorts` and a
`configureChild({ thread, parent, modelKey })` model-binding callback. The native extension
registers the tools and durable jobs, and consults the shared request-limit policy at the
model boundary. Goal and subagent workflows still share the product decisions and their
transactional behavior handlers.

Managed child input resolves its native parent and calls the shared continuation rules.
It keeps the native child identity and creates the existing result job. Root `/goal` input
uses the shared command entry. Explicit root `interrupt()` records user stop before
cancelling; child interruption follows its current shared ownership. Opening installs
model bindings and runs `onOpen` before scheduler resume. Desktop hosts can select owned conversations and rebind root configuration before this recovery. Inherited model context remains visible, while behavior authority and summary charges come only from conversation-owned records. That policy stops interrupted
background children and disarms goals; ordinary unfinished root tasks can resume.

Behavior facts are folds: each conversation's history, children, runs, reservations, run usage and
last replies are reduced one entry and task at a time, without entry bodies or images. A read advances
the fold inside its own transaction before any write. Session reads see only published commits, the
mutation line mints IDs in commit order and tasks are never deleted, so the fold reads only entries and
tasks newer than it has seen, plus point reads of unfinished jobs, the newest generation task and
reservations whose submission has no run yet. A sequential tool round creates later calls' tasks after
their assistant entry; folding such a task rewrites that call's key and the keys of results resolved
through it. The tool gate, append validation and child message, answer and stop paths read folds or
point state, never a child's history. A fold unused for 10 minutes is dropped on the next read and
rebuilt from empty; closing the Session drops every fold.

Native Durable compaction generates its own summary. Its task captures the history boundary and initiating run;
each summary request checks that run's request limit. Reported usage is persisted in the same native transaction
as the response and projected once into goal and child-run accounting, including after restart. The gateway owns
provider billing independently.

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

The runtime `durable.commit` facet shares the existing native mutation line; desktop fork operations retain the backend while using it. The thread `durable` facet exposes native configuration, compaction, run state,
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
Archive tests cover pagination, reset, fork ownership, stable identities after
SQLite reopen and reads limited to newer entries. History tests check fold order independence and eviction; the fold suite compares every warm fold with a
rebuild across the behavior contract and counts the rows repeated reads and child paths touch; a relation test checks that creation evidence is read without later child history. Projection tests cover repeated text, ambiguous coalesced frames,
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

## Detached prompt prediction

`durable.predictPrompt(instruction, signal)` uses the patched native
`Conversation.createQueryFork()` to snapshot the committed compacted context returned by `contextUsage`.
The shared pi-ai fork makes one streaming model request without submitting input,
writing transcript/history, creating tasks or changing goals. It retains the parent
model, reasoning, session identity and tool declarations, but aborts at the first
streamed tool call before any tool can execute. Owner shutdown cancels the request.

The pi-ai dependency patch carries `skipCacheWrite` through provider option conversion.
Anthropic, Anthropic-compatible chat completions and Bedrock retain the parent's
explicit cache breakpoints and add none for the response/prediction suffix. This is
not `cacheRetention: 'none'`: cache reads remain enabled. Automatic server-side cache
writes are provider-controlled; the flag does not promise to disable those writes.
Continuation state and parent reply usage/budget accounting are not updated by the fork.
There is no prediction-specific reasoning, timeout or retry override.

Prediction requires at least two assistant messages, a successful latest response,
and documented uncached/cache-write token gates. The host owns turn-end scheduling,
focus/Plan/preference gates and source-reply validation; renderer reads consume the
existing ephemeral result without triggering another query.
