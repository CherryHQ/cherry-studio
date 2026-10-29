# Agent Note: Runtime access, input, observation, and lifecycle contracts

Status: proposed

English | [中文](2026-10-17-agent-runtime-contract.zh.md)

## Problem

Cherry needs to open native contexts, submit input, observe work independently of a particular submission, and release resources across different harnesses. Requiring every harness to adopt Cherry's session engine would duplicate native scheduling and recovery. A large capability matrix would instead make every consumer interpret those differences itself.

This note replaces the stack's runtime ownership and behavior design. It records the implemented v0 access boundary and its reasons, together with the host obligations still needed for integration. [Common types](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime/src/contracts.ts), the [Pi adapter](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/src/runtime.ts), and the [Pi Durable adapter](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi-durable/src/runtime.ts) own exact signatures. Package code exists; desktop adoption and the full acceptance below remain incomplete. The [harness boundaries](2026-10-17-agent-harness-boundaries.md) own the broader division of responsibilities.

Implementation facts in this note refer to the cumulative runtime stack inspected at `bd6509eb5f71a9c6bbb57453f0a7ced25e92c766`. Behavior supplied by later layers remains a target at this layer; the note does not claim those features are already present here. Source links use that fixed snapshot, and notes not yet introduced link to their owning PR.

The [SDK content protocol proposal](../simplification/2026-10-29-agent-runtime-content-protocol.md) now owns the planned replacement of `ContentItem` and the move of SDK content accumulation to the shared observation source. The item events and Main readers described below remain the current implementation until that migration; access, input admission, lifecycle, native recovery, and product ownership remain governed here.

## Proposal

### Keep the common entry small

The current public shape is:

```typescript
interface AgentRuntime {
  open(ref: Thread): Promise<OperationResult<ThreadHandle>>
  shutdown(): Promise<OperationResult<ShutdownReceipt>>
}

interface ThreadHandle {
  readonly thread: Thread
  readonly inputPolicies: readonly BusyPolicy[]
  submit(input: InputDraft): Promise<SubmitResult>
  observe(sink: ObservationSink): Promise<OperationResult<Observation>>
  interrupt?: () => Promise<OperationResult<InterruptReceipt>>
  release(): Promise<void>
}

interface Observation {
  stop(): Promise<void>
}
```

| Entry | Why it is separate |
| --- | --- |
| `open` | Access a known context without creating a replacement or overwriting its configuration. |
| `submit` | Hand input to native admission. Its receipt is separate from observed output and does not own one exclusive response stream. |
| `observe` | Reattach to existing work, including child work that continues without a new submission. |
| `interrupt?` | Offer native interruption only where it exists, with its actual scope. |
| `release` / `stop` | End a caller's access or observation without cancelling work owned elsewhere. |
| `shutdown` | Let the resource owner close the entire configured runtime instance. |
| `thread` / `inputPolicies` | Save an addressable context and choose supported input arrangements without interpreting a generic capability language. |

Asynchronous factories and `create` stay adapter-specific. Pi accepts `AgentRuntimeSessionOptions`, including native `ModelRuntime`, `Model`, and `SessionManager`; Pi Durable accepts native `HarnessOptions`, an exclusively owned storage factory, and `ConversationCreateOptions`. These remain typed configurations, not arbitrary option bags. Initialization cleans up resources it acquired on failure; shared host model services remain borrowed resources.

Pi Durable additionally exposes runtime-wide `resume`, and input lookup, retraction, and deduplication on its concrete handle. Native command discovery, configuration changes, context editing, and forking are not mandatory common methods. Tools, approval, and model bridges stay at their existing adapter/host boundaries. Shared behavior is extracted only when a consumer needs the same semantics across implementations.

The v0 interface has no universal `spawn`, exact delegation cancellation, interaction response, history pagination, or replay cursor. Its mandatory `submit` and `Delegation.child` cannot fully express observation-only or inaccessible children. [Optional subagent controls](https://github.com/CherryHQ/cherry-studio/pull/21578) are a separate proposal, not already implemented signatures. Current Pi managed-child handles expose no input policies and return `unsupported` for submission; direct child prompting must not bypass the extension owner.

### Treat submission as native input admission

`InputDraft` contains a host `inputId`, `text`, and `whenBusy: 'reject' | 'steer' | 'follow-up'`. It is native user input, which may invoke commands or hooks before reaching model admission.

```text
Input -> native command/input hooks -> locally handled
                                  -> model admission applies whenBusy
```

| At native model admission | `reject` | `steer` | `follow-up` |
| --- | --- | --- | --- |
| Foreground idle | May start work. | May start work. | May start work. |
| Foreground busy | Reject this model input without queueing it. | Arrange steering at a supported native boundary. | Arrange subsequent input under native rules. |

This is not an atomic condition on a named execution or proof that all background work and queues are empty. Unsupported policies are rejected before native dispatch. Configuration or closed resources can still prevent otherwise permitted input. A command or hook handled earlier is outside the busy policy: Pi's `/goal pause` can be handled while busy even with `reject`. `locally-handled` identifies the path, not command success. Skipping Pi prompt-template expansion does not skip all input handlers and therefore cannot implement a side-effect-free idle-only operation. Such a guarantee needs native atomic admission or constrained extensions, not a preceding `isIdle` check.

Submission receipts report evidence: `accepted`, `queued`, `dispatch-started`, `locally-handled`, and `placed` are a fact set, not a linear state machine. Queueing, dispatch, and placement do not prove model consumption. Acknowledgement does not prove execution completion or goal success. General operations return `confirmed`, `rejected`, `unsupported`, or `unknown`; submission uses `acknowledged` for confirmed handoff. Expected failures are results; programming errors may still throw. Error codes are strings in v0, not an exhaustive public enum. Diagnostic messages must avoid secrets and raw native objects; the host connects the injected error callback to `loggerService`.

Return rejection only when non-admission is known. Unknown results must remain unknown; later query failure cannot undo confirmed admission. The host persists the logical input and transport attempt before submitting, retains its Promise after a window stops waiting, and records late receipts. `input.changed` can confirm a logical input without proving which uncertain transport attempt succeeded. The runtime does not supply a durable host delivery journal.

The same `InputId` keeps immutable text and busy policy. New content is a new logical input. Pi has no persistent native input deduplication, so an unknown result must not trigger automatic retry. Durable's native deduplication key and lookup permit a different delivery policy; the host stores their relationship to `InputId` and replays the original draft. Native same-type deduplication does not validate payload equality. A missing lookup is not proof that no side effect occurred. Retraction distinguishes `withdrawn`, `already-placed`, and `already-settled`; retracting one input is not conversation interruption.

### Expose identities needed by consumers

| Public identity | Purpose |
| --- | --- |
| `Thread { backendId, id }` | Locate native context in a configured backend; persistence is conditional on native storage. |
| `InputId` | Host logical input identity, unique at least within its target context, independent of transport attempts. |
| `ItemRef { session, id }` | Identify updateable content and tool relationships. |
| `DelegationRef { session, id }` | Identify evidence of an assignment, independently of the reusable child context. |
| `NativeInputRef { session, id }` | Address a real native input for lookup or retraction when supported. |

IDs use distinct branded string types. Consumers can serialize them but must not interchange them, parse prefixes, or infer lifetime from formatting. The host supplies `InputId`; adapters return native/context/content references. Validate storage and transport data before restoring branded IDs. The host assigns a stable `backendId` namespace and ensures a single writer for it; v0 adds no interprocess lock.

`SourceRef`, epoch, revision, and sequence stay internal to source mapping and ordering. Transport `attemptId`, cross-process projection revisions, and subscription replacement markers belong to the host. There is no universal call context or cancellation signal that conflates stopping local waiting, interrupting native work, and ending observation.

An adapter normalizes content once per shared source. Reobserving that live source preserves item identity. Pi currently assigns live message identities and resets its mapping on rebinding/compaction; they are not persistent history keys. Durable can derive saved item identity from native entries but uses an ephemeral epoch for previews. A known mapping can emit `replaces`; otherwise `gap` plus a replacement snapshot marks the break. IDs from a lost mapping must not be guessed equivalent across runtime reconstruction.

### Keep the observation a readable source view

Common content contains text/reasoning message parts, tool calls with possibly incomplete `argumentsText`, and tool results with optional serializable `JsonValue`. It does not export SDK objects, UI chunks, or a native replay format. `complete` describes content completeness, not goal achievement. Foreground `Activity` says nothing about all background tasks or pending preflight.

A parent snapshot may expose `Delegation` records with independently openable child threads. The current two adapters route discovered native children through the same runtime; host-owned cross-harness routing is a separate concern. The parent observation does not recursively mix in child content. Missing `delegations` means discovery is unavailable; an empty array means none are currently visible, not that no child ever existed. Current adapters report `unknown` where they lack completion evidence. Pi relates children to their creation/continuation trigger; Durable uses native owner-task relationships. Subsequent child input alone is not proof of a new delegation or completion of the old one.

Snapshots replace only that source's current view, never the host archive, another thread, or a child view. Current adapters provide `current-view`; the protocol also permits `live-only` and `retained-view`. None promises every historical branch. An observation starts with a snapshot, then uses `item.upsert`, `item.remove`, `input.changed`, `activity.changed`, `delegation.upsert`, `diagnostic`, `gap`, and `closed`. Upserts carry accumulated values, not arbitrary token chunks; item removal is not native context deletion. Execution and interaction events are not reserved placeholder variants in v0.

[ThreadFeed](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime/src/observation.ts) clones the view and events, serializes delivery within each sink, and isolates observers. The sink can run before the `observe` Promise returns, so its thread and subscription context must be captured in advance. Registration confirmation does not mean that the consumer has persisted the first frame. A sink's awaited Promise applies backpressure only to that observer, not to synchronous native dispatch or other sinks.

Pending delivery is bounded. The current feed coalesces overflow beyond 100 pending frames into an explicit `gap` and replacement snapshot while preserving the initial-snapshot requirement. This recovers a current view, not every dropped historical event. Mapping loss and disconnection are also explicit gaps; unrecoverable source loss closes observation. Snapshot attachment must not silently omit changes at the registration boundary.

After `stop` or access release, no new sink call starts; an already-entered asynchronous consumer may finish. Stop is idempotent and its resolution is sufficient acknowledgement, without a mandatory final callback. Shutdown/source loss sends `closed` on a best-effort basis. A throwing sink is detached and reported outside that sink without escaping into native dispatch. The host owns projection flush and fences old subscription writes before replacing an observation. Per-sink ordering does not solve cross-process replay or merging independent observers.

### Coordinate access without owning execution

Concurrent opens of the same context within one runtime share a load and native owner. `open` validates the backend and native identity, returns `not-found` for missing context, and does not fall back to `create`. Pi's host loader must return the exact saved manager/configuration and must not turn an empty or missing file into a new session. Reopening a saved thread in a new runtime creates new access and observation objects; unsaved context is not recoverable merely because it has an ID.

There is no per-thread eviction or automatic disposal on the last release. Resources and the current normalized view stay until runtime shutdown, so one released access cannot disrupt other callers or hidden native work. This retains memory as more threads are opened; the host needs a residency policy. Closing a shared Durable Harness to reclaim one conversation would close the entire group. Independent eviction requires a later, natively verified contract.

Each context serializes public submission admission until acknowledgement/rejection evidence or the native call settles, not until the entire model run ends. Waiting calls are local coordination, not an additional accepted or persistent queue. Native extensions and other processes are outside this ordering. A stuck Pi preflight can block subsequent public admission to that context; other contexts remain independent. The adapter does not guess failure after a timeout.

Interrupt bypasses the admission barrier. It does not cancel local undispatched attempts or guarantee that a pending preflight cannot later start. Release seals that access, prevents its queued attempts from dispatching, and lets already dispatched operations settle. The host still collects their results. If a cancelled product action later acquires an access or observation, it releases/stops that resource without deleting any context already created. A strict stop-and-remain-idle product operation would also need to seal host delivery and coordinate pending admission and native queues; v0 does not promise that atomic operation.

### Make adapter control scope explicit

| Operation | Pi | Pi Durable |
| --- | --- | --- |
| Initialize / open | Load and validate native context; extension initialization may have effects. No promise to restore in-flight calls or memory queues. | `Harness.open` reconciles saved native state; opening a conversation does not enable scheduling. |
| Observe / lookup | Observe known context without prompting; no native input lookup extension. | Use watch/status/submission lookup without calling a scheduler-enabling wait. |
| Submit | Native prompt and preflight evidence; idle steering is not mapped to a direct native steer call. Managed-child submission is unsupported. | Native transactional input admission; submit can enable the shared scheduler even if this input is rejected. |
| Interrupt | Owned access calls its session owner; a managed background child is stopped through the parent's controller, and a streaming foreground child may require aborting the parent turn. | Default `Conversation.abort` scope retracts queued inputs and interrupts owned nonbackground work. It enables scheduling and excludes queued writes and background work. |
| Resume / retract | No common Pi implementation of these native facilities. | Runtime-wide scheduler activation; separately, native submission retraction with placement/settlement receipts. |
| Shutdown | Seal access, track admission and native calls, abort and dispose owners through their lifecycle, then close observations. | Close the shared Harness, tracked operations, projections, and owned storage. Closing is not persistent task cancellation. |

For Pi, ordinary parent interruption does not stop all background children. The extension records the user abort and suppresses automatic parent wake-up; foreground cancellation follows its native ownership. Explicit child interruption uses child-level control. A background child's `requested` receipt does not prove termination; even `native-scope-idle` does not prove that queues, preflight, all extensions, or later work are stopped. These distinctions cannot be inferred merely from the presence of `interrupt`.

The resource owner must accept Durable's Harness-wide scheduling effects before using submit/interrupt/resume. Native recovery does not promise exactly-once external tool side effects. Strictly narrower controls need a concrete adapter capability or an upstream improvement, not a generic capability matrix that pretends all effects are equivalent.

### Close the runtime, not the product history

`shutdown` retires this configured adapter instance and all its contexts' access resources. It does not close another runtime instance, delete product or native history, undo tool effects, or universally mark every task cancelled. The instance and its old handles cannot be reused after shutdown; create a new runtime to reopen saved context.

Shutdown seals new open/create/submit/resume/control calls, rejects undispatched work, tracks already-started operations, and releases owned resources. Repeated calls share one shutdown attempt. Unknown cleanup keeps the runtime closed to new work and must not return confirmed `closed`. Pi may need to wait for an uncancellable preflight; there is no bounded shutdown-time guarantee. Host cancellation of waiting does not cancel the cleanup Promise. The host coordinates projection flush before process exit and must not invoke native wait merely to drain observations if that would start scheduling.

Pi can reopen persisted context but does not resume an interrupted execution or unsaved queues. Pi Durable can resume nonterminal tasks after reopening suitable persistent storage under native recovery rules; in-memory storage cannot survive process exit. Shutdown is therefore not a common save-and-pause operation.

| Host action | Appropriate access operation |
| --- | --- |
| Close a window | Stop its subscription and release its access if no longer needed; a host projection may continue observing. |
| Stop generation | Interrupt the addressed context if supported, interpreting the adapter's native scope. |
| Exit the app or retire an execution environment | Shut down the corresponding runtime and coordinate host persistence/flush. |
| Open existing work | Open the saved thread, observe it, then submit if that access supports the desired policy. |
| Follow a child after the parent finishes | Open the discovered child and observe it independently of the parent message. |

## Alternatives considered

- Make `submit` return the only output stream: rejected because queued input, unsolicited native work, reconnects, and child streams do not share that lifetime.
- Add a second `Backend` abstraction or a string matrix for every native effect: rejected because the configured `AgentRuntime` already owns access, and consumers still need concrete native semantics.
- Put creation, tools, history editing, fork, resume, and delegation controls into the mandatory interface: rejected because current native capabilities and ownership differ. Keep typed adapter extensions until common use is established.
- Expose internal epochs, revisions, attempts, or raw SDK payloads: rejected because source mapping belongs to adapters and delivery/projection coordination belongs to the host; these fields would not create durable guarantees.
- Retry unknown input, dispose on last release, or simulate atomic idle admission with a local flag: rejected because each can lose evidence or race work the adapter does not own.

## Acceptance criteria

The [evidence note](../testing/2026-10-17-agent-harness-evidence.md) distinguishes existing tests and historical probes from acceptance not yet run. This documentation migration does not claim a new execution of those tests or complete host integration.

- AC1 — Repeated and concurrent opens share native ownership, validate identity, and never replace missing context by creating a new one. (verification: unit — Pi and Pi Durable runtime tests)
- AC2 — Input receipts preserve native admission evidence across busy policies, hooks, unknown results, late acknowledgement, deduplication, and release races. (verification: unit — adapter admission and host delivery tests)
- AC3 — Multiple observers see consistent source identity and snapshot-first ordered delivery; overflow, mapping loss, sink failure, and stop are explicit and isolated. (verification: unit — ThreadFeed and adapter projection tests)
- AC4 — Releasing one access does not stop another access or native work; shutdown closes the whole owned instance without claiming history deletion or unsupported execution recovery. (verification: unit — adapter lifecycle and persistent-store reopening tests)
- AC5 — Child observation survives the parent message, managed-child controls preserve native ownership, and native result delivery is not duplicated by observation. (verification: unit — adapter child tests and host projection integration)
- AC6 — Desktop callers preserve logical input receipts and archives, fence replaced observations, flush outstanding writes, and present native interruption/scheduling scope accurately. (verification: Electron — product-session runtime integration)

## Risks

The present access API deliberately leaves gaps: Pi managed-child input, inaccessible child relations, exact assignment cancellation, and host cross-harness orchestration remain proposals. Retaining contexts until shutdown increases memory use; uncancellable preflight can delay shutdown indefinitely. Normalized views omit native data and can lose intermediate events under backpressure. Durable logical-input mappings are not a replacement for a host journal. Treating any of these limitations as already solved by a shared type would make the abstraction stronger on paper than its implementations.
