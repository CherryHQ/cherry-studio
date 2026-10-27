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
captured configuration and credentials. Command discovery, context usage and
permission-mode updates use typed native methods on `claude`, without exposing
the Query iterator to a second reader.

`claudeThread(backendId, sessionId, agentId?)` constructs a reference from established
native identity. Hosts store the opaque `Thread.id`; they do not parse its encoding.
A child is a native root session plus stable agent ID, independent of run ID and
tool invocation. Child accesses have no common input or interrupt operation.

Stopping a subscription or releasing a handle only detaches that access. A parent
result does not end child observation. `shutdown()` closes admission, asks the SDK
to close, joins its event reader and subprocess exit, and reconciles available
archives before ending feeds. An unconfirmed exit returns `unknown` and retains
the owner; retry shutdown after the host resolves process termination. Handles
may still read archives after shutdown until released. Native history is not deleted.

## Input and control

Root `input.submit` supports `steer` and `follow-up`, mapped to native `next` and
`later` priority. Busy `reject` is unsupported because the SDK exposes no atomic
rejection operation. Steering can become a later turn when no tool boundary remains.
Native Agent/SendMessage own child continuation; no direct child send is fabricated.

Each logical input receives a native UUID. Reusing an input ID on the same owner
is rejected; this is not durable deduplication. The submit receipt initially proves
only `dispatch-started`. Correlated output establishes placement; the native result
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
Typed batches pair normalized events with the exact native payload and source
retractions. Rich blocks, thinking signatures, usage, reset and local-command
metadata remain native types. The adapter never introduces SDK types into the
common package. `ClaudeFeed` uses `ThreadFeed` for normalized state and bounds
delivery of paired batches; overflow emits a gap and a matching current baseline.
Slow or failing consumers cannot block native execution. Closing drains the final
queued state before the closed event; releasing explicitly discards that subscriber.

Committed item IDs use transcript UUID and block ordinal. Provisional root blocks
carry `replaces` when committed; distinct UUIDs sharing an API response ID remain
distinct. Child output has native complete-block granularity. Aborted content stays
partial. Explicit retractions are retained in live snapshots and archives so replay
cannot revive removed sources. A newer task run cannot be ended by an older run's
late event. Missing parent evidence leaves relationships unresolved.

`claude.archive()` returns the native selected view, normalized items, source IDs,
and explicit retractions. SDK history APIs and native export run in an isolated
worker with the backend's configuration environment; the caller's environment is
unchanged. Live events are buffered during reconciliation and applied afterward.
Compaction selects a new model context without deleting previously observed product
content. Missing native files return an error instead of a writable replacement.
Archive projection types do not retain every live SDK field; the desktop must keep
its richer saved parts and persist source mappings/retractions with its checkpoint.

## Verification and desktop migration

```sh
pnpm --filter @cherrystudio/agent-runtime-claude-code build
pnpm --filter @cherrystudio/agent-runtime-claude-code typecheck
pnpm test:agent-runtime-claude-code packages/agent-runtime-claude-code/tests/runtime.test.ts packages/agent-runtime-claude-code/tests/observation.test.ts
```

Runtime tests call the public package using the real SDK, CLI, native Agent and
SendMessage tools, isolated session files, and a scripted local Messages endpoint.
Wire tests use the real SDK transport with controlled native frames to reproduce
retractions, late runs, delivery gaps and consumer failures. Neither is a real-model
or Electron acceptance test.

This is the C1 package layer of the
[Claude migration Spec](../../.agents/notes/proposed/architecture/2026-10-27-agent-runtime-claude-code.md).
C2 connects desktop contexts, approval/question callbacks, provider routes, prewarm
ownership, billing, fork/edit, and shared message projections, then removes the
migrated Claude background-flow writer. The existing desktop driver remains active.
