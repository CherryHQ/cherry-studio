# Pi Durable agent runtime

`createPiDurableRuntime` adapts Pi Durable 1.4.0 to the
[agent runtime contracts](../agent-runtime/README.md). It owns one native `Harness`,
its storage, conversation watches, and the task graph watch. It does not implement
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

`resume()` enables the entire Harness scheduler. Reading with `open`, `observe`, or
`lookupInput` does not resume it. Native `submit` and `interrupt` can resume the entire
Harness, including other conversations. Without shared behavior, `interrupt()` uses native ordinary-scope
abort: queued inputs and owned non-background work are included; queued writes and
background subtrees are not. These effects are not application-wide cancellation.

## Input and output

Every Durable access provides `input.submit({ ...input, deduplicationKey? })` and
`input.policies`, plus `lookupInput(query)` and `retractInput(nativeRef)`. Busy rejection comes from native
`ConversationBusy`; uncertain failures return `unknown`. Once native admission
returns, a failed status read cannot erase the acknowledged receipt. Deduplication
is native and conversation-scoped: the host must reuse the original immutable
input and policy with its key. Inputs submitted through this adapter retain their
logical InputId in native entry metadata, so placement and later status reads can
recover it after reopening. External native submissions may lack that logical ID.

`whenBusy: 'steer'` delivers input at the next native input boundary. If the current
run finishes normally before taking it, the input starts a subsequent run. `follow-up`
waits for the final boundary. Both policies start a run when the conversation is idle;
normal completion does not discard accepted input. Explicit interruption still follows
the native cancellation scope. Read `lookupInput` or `input.changed` to distinguish
acceptance from placement and completion.

Settled input exposes `response` from the native answer entry when available. Several submissions
may share it. Native `done` alone is insufficient: Durable 1.3.0 also uses it for truncated output
and tool-only termination. The adapter reads the actual assistant stop reason before reporting
`completed`; truncation becomes `unanswered` with `output-truncated`. Native aborted submissions
map to `aborted`, known model/task failures to `failed`, and other unanswered reasons remain
`unanswered`. A late status read cannot downgrade a known terminal state. These reads do not
enable the scheduler.

Observations normalize committed `ConversationView` snapshots, live assistant
partials, tool calls/results, and retained live tool output. Coverage is
`current-view`, not a history archive. Persistent entries use native entry IDs;
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

Native ownership records and live task graph edges expose `Subagent` relationships
through `snapshot.subagents` and `subagent.upsert`. Their IDs use the native child
conversation ID within the parent, so subsequent inputs retain the same relationship.
They carry no assignment completion status. Open and observe a child separately;
parent output does not recursively contain it. On restart discovery covers the
current native task graph, not every historical child.

Without shared behavior, child access can submit further input after the parent access is released. Direct
conversation input does not create a reporter task or another parent result. The
raw adapter never delivers child results to the parent; native tasks own that behavior.

`durable.compact()` waits for the native task and its summary write to settle.
Its receipt distinguishes a committed summary from a no-op (including a declined
summary); a failed or unplaced summary is never reported as committed.

Input observations publish changed evidence only. Polling an unchanged pending
receipt does not emit another `input.changed` or wake an observer's reconciliation loop.

## Shared behavior

The optional `behavior` factory option installs `agent-behavior` with Cherry's
`HostPorts` and a `configureChild` model-binding callback. Native tools, transactional
records, hooks, memo, jobs and waits implement the harness ports. Product rules remain
in `agent-behavior`; this adapter contains no second subagent or goal policy engine.

Managed child input calls the shared `messageSubagent` entry, so background continuation
keeps the native child identity and creates the shared result job. Root `/goal` input
uses the shared command entry. Explicit root `interrupt()` records user stop before
cancelling; child interruption follows its current shared ownership. Opening installs
model bindings and runs `onOpen` before scheduler resume. That policy stops interrupted
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

The concrete `durable` facet exposes native configuration, compaction, behavior facts,
provider session identity and tool-call resolution for the desktop adapter. These stay
outside the harness-neutral Runtime contract. `onInputPlaced` runs synchronously at
native placement so the host reserves input attribution before the next model request.

Declared differences in the shared contract suite:

- Durable never invokes `ContextFilter`: pending input has not entered history. Two
  context-filter cases are skipped; the request cap is enforced by the native model wrapper.
- A completed foreground child still belongs to its original native tool task. Independent
  background continuation is rejected before writing run records or report jobs. One
  foreground-continuation case is skipped; there is no implicit fork or id forwarding.
- The desktop does not expose native fork/edit checkpoints or `vcc_recall` yet.

## Validation

Offline tests use the native faux provider and native Memory/Node SQLite storage:

```sh
pnpm --filter @cherrystudio/agent-runtime build
pnpm test:agent-runtime-pi-durable packages/agent-runtime-pi-durable/tests/behaviorContract.test.ts packages/agent-runtime-pi-durable/tests/runtime.test.ts packages/agent-runtime-pi-durable/tests/runMetadata.test.ts packages/agent-runtime-pi-durable/tests/projection.test.ts
pnpm --filter @cherrystudio/agent-runtime-pi-durable typecheck
```

The child test covers continued conversation, busy rejection, steering, independent
observation after release, stable relationship identity, and unchanged parent output.
Archive tests cover pagination, reset, fork ownership and stable identities after
SQLite reopen. Projection tests cover repeated text, ambiguous coalesced frames,
retries and tool progress. Shared behavior cases exercise native transactions, goal and
child ownership, stop, delivery, approval and reopen; run-metadata tests distinguish
same-run steering from late continuation. SQLite tests close and reopen an orderly
runtime; they do not prove process-kill recovery or exactly-once external side effects.
Desktop and live-provider acceptance are separate from these package tests.
