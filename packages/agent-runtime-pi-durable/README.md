# Pi Durable agent runtime

`createPiDurableRuntime` adapts Pi Durable 1.3.0 to the
[agent runtime contracts](../agent-runtime/README.md). It owns one native `Harness`,
its storage, conversation watches, and the task graph watch. It does not implement
another scheduler, submission queue, or agent loop. Not wired into the desktop app yet.

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

`resume()` enables the entire Harness scheduler. Reading with `open`, `observe`, or
`lookupInput` does not resume it. Native `submit` and `interrupt` can resume the entire
Harness, including other conversations. `interrupt()` uses native ordinary-scope
abort: queued inputs and owned non-background work are included; queued writes and
background subtrees are not. These effects are not application-wide cancellation.

## Input and output

Every Durable access provides `input.submit({ ...input, deduplicationKey? })` and
`input.policies`, plus `lookupInput(query)` and `retractInput(nativeRef)`. Busy rejection comes from native
`ConversationBusy`; uncertain failures return `unknown`. Once native admission
returns, a failed status read cannot erase the acknowledged receipt. Deduplication
is native and conversation-scoped: the host must reuse the original immutable
input and policy with its key. The host also persists the logical InputId mapping;
a reopened runtime can return a native input reference without that host ID.

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
live previews use an internal source namespace. Where preview-to-entry association
is not proven, the adapter emits `gap: mapping-reset` and a replacing snapshot.
Consumers must not merge these by text. Images and nested-tool progress are not
represented by the current common text/reasoning protocol.

Native ownership records and live task graph edges expose `Subagent` relationships
through `snapshot.subagents` and `subagent.upsert`. Their IDs use the native child
conversation ID within the parent, so subsequent inputs retain the same relationship.
They carry no assignment completion status. Open and observe a child separately;
parent output does not recursively contain it. On restart discovery covers the
current native task graph, not every historical child.

Child access can submit further input after the parent access is released. Direct
conversation input does not create a reporter task or another parent result. The
adapter never delivers child results to the parent; native tasks own that behavior.

## Validation

Offline tests use the native faux provider and native Memory/Node SQLite storage:

```sh
pnpm --filter @cherrystudio/agent-runtime build
pnpm test:agent-runtime-pi-durable packages/agent-runtime-pi-durable/tests/runtime.test.ts
pnpm --filter @cherrystudio/agent-runtime-pi-durable typecheck
```

The child test covers continued conversation, busy rejection, steering, independent
observation after release, stable relationship identity, and unchanged parent output.
The SQLite test closes and reopens an orderly runtime; it is not a crash-recovery or
external-tool side-effect test. No live provider or Electron acceptance is claimed.
