# Agent Note: Runtime access, input, observation, and lifecycle contracts

Status: proposed

English | [中文](2026-10-17-agent-runtime-contract.zh.md)

## Problem

Cherry needs to open native contexts, submit input, observe work independently of a particular submission, and release resources across different harnesses. Requiring every harness to adopt Cherry's session engine would duplicate native scheduling and recovery. A large capability matrix would instead make every consumer interpret those differences itself.

This note replaces the stack's runtime ownership and behavior design. It records the implemented v0 access boundary and its reasons, together with the host obligations still needed for integration. [Common types](../../../../packages/agent-runtime/src/contracts.ts), the [Pi adapter](../../../../packages/agent-runtime-pi/src/runtime.ts), and the [Pi Durable adapter](../../../../packages/agent-runtime-pi-durable/src/runtime.ts) own exact signatures. Pi and Pi Durable desktop calls now use the common Runtime and independent child projections. The full acceptance below remains incomplete; delivered integration does not establish every recovery or performance guarantee. The [harness boundaries](2026-10-17-agent-harness-boundaries.md) own the broader division of responsibilities.

The [SDK content protocol proposal](../simplification/2026-10-29-agent-runtime-content-protocol.md) now owns the planned replacement of `ContentItem` and the move of SDK content accumulation to the shared observation source. The item events and Main readers described below remain the current implementation until that migration; access, input admission, lifecycle, native recovery, and product ownership remain governed here.

## Proposal

### Keep the common entry small

The current public shape is:

```typescript
interface AgentRuntime {
  open(ref: Thread): Promise<OperationResult<ThreadHandle>>
  shutdown(): Promise<OperationResult<ShutdownReceipt>>
}

interface ThreadInput {
  readonly policies: readonly BusyPolicy[]
  submit(input: InputDraft): Promise<SubmitResult>
}

interface ThreadHandle {
  readonly thread: Thread
  readonly input?: ThreadInput
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
| `input?.submit` | Hand input to native admission where this access supports it. Its receipt is separate from observed output and does not own one exclusive response stream. |
| `observe` | Reattach to existing work, including child work that continues without a new submission. |
| `interrupt?` | Offer native interruption only where it exists, with its actual scope. |
| `release` / `stop` | End a caller's access or observation without cancelling work owned elsewhere. |
| `shutdown` | Let the resource owner close the entire configured runtime instance. |
| `thread` / `input.policies` | Save an addressable context and choose supported input arrangements without interpreting a generic capability language. |

Asynchronous factories and `create` stay adapter-specific. Pi accepts `AgentRuntimeSessionOptions`, including native `ModelRuntime`, `Model`, and `SessionManager`; Pi Durable accepts native `HarnessOptions`, an exclusively owned storage factory, and `ConversationCreateOptions`. These remain typed configurations, not arbitrary option bags. Initialization cleans up resources it acquired on failure; shared host model services remain borrowed resources.

Pi Durable additionally exposes runtime-wide `resume`, `lookupInput` and `retractInput` on its concrete handle, and deduplication through `input.submit`. Native command discovery, configuration changes, context editing, and forking are not mandatory common methods. Tools, approval, and model bridges stay at their existing adapter/host boundaries. Shared behavior is extracted only when a consumer needs the same semantics across implementations.

The interface has no universal `spawn`, exact assignment cancellation, interaction response, history pagination, or replay cursor. Optional `ThreadHandle.input` represents observation-only access; optional `Subagent.child` represents a relationship without an accessible context. Both concrete Pi and Durable handles currently provide input. Pi managed-child input goes through the extension owner, with only `steer` exposed. The [subagent control note](2026-10-18-agent-runtime-subagent-control.md) records this implemented slice and the remaining control proposals.

### Treat submission as native input admission

`InputDraft` contains a host `inputId`, `text`, and `whenBusy: 'reject' | 'steer' | 'follow-up'`. The concrete access determines the native input path. An ordinary Pi root prompt may invoke commands or hooks before reaching model admission:

```text
Input -> native command/input hooks -> locally handled
                                  -> model admission applies whenBusy
```

| At native model admission | `reject` | `steer` | `follow-up` |
| --- | --- | --- | --- |
| Foreground idle | May start work. | May start work. | May start work. |
| Foreground busy | Reject this model input without queueing it. | Arrange steering at a supported native boundary. | Arrange subsequent input under native rules. |

This is not an atomic condition on a named execution or proof that all background work and queues are empty. Unsupported policies are rejected before native dispatch. Configuration or closed resources can still prevent otherwise permitted input. A command or hook handled earlier is outside the busy policy: Pi's `/goal pause` can be handled while busy even with `reject`. `locally-handled` identifies the path, not command success. Skipping Pi prompt-template expansion does not skip all input handlers and therefore cannot implement a side-effect-free idle-only operation. Such a guarantee needs native atomic admission or constrained extensions, not a preceding `isIdle` check.

Pi managed-child input instead uses the owner's `messageSubagent`: a live run receives a queued message, while a finished child is loaded and starts a new background run. It accepts only `steer`; it does not reinterpret slash text as root commands or emulate other policies. Continuation retains the controller's load requirement, user-stop refusal, and native result delivery. These semantics are not a non-waking messaging guarantee.

Submission receipts report evidence: `accepted`, `queued`, `dispatch-started`, `locally-handled`, and `placed` are a fact set, not a linear state machine. Queueing, dispatch, and placement do not prove model consumption. Acknowledgement does not prove execution completion or goal success. General operations return `confirmed`, `rejected`, `unsupported`, or `unknown`; submission uses `acknowledged` for confirmed handoff. Expected failures are results; programming errors may still throw. Error codes are strings in v0, not an exhaustive public enum. Diagnostic messages must avoid secrets and raw native objects; the host connects the injected error callback to `loggerService`.

Return rejection only when non-admission is known. Unknown results must remain unknown; later query failure cannot undo confirmed admission. For message-backed input, the host saves the user message and the Main-private submission information needed for routing/recovery before submitting, retains its Promise after a window stops waiting, and records late receipts. `input.changed` can confirm a logical input without proving which uncertain transport attempt succeeded. P1 requires neither a separate input table nor per-attempt history. The runtime does not supply a durable host delivery journal.

The same `InputId` keeps immutable text, target and busy policy. Changing them creates a new logical input. Pi has no persistent native input deduplication, so an unknown result must not trigger automatic retry. Durable's native deduplication key and lookup permit a different delivery policy; for message-backed input, Main can explicitly pass the message ID as the key and query the captured target after reopening. Any permitted retry requires the original actual draft, not reconstruction from edited display content. Native same-type deduplication does not validate payload equality. A missing lookup is not proof that no side effect occurred. Retraction distinguishes `withdrawn`, `already-placed`, and `already-settled`; retracting one input is not conversation interruption.

### Expose identities needed by consumers

| Public identity | Purpose |
| --- | --- |
| `Thread { backendId, id }` | Locate native context in a configured backend; persistence is conditional on native storage. |
| `InputId` | Host logical input identity, unique at least within its target context, independent of transport attempts. |
| `ItemRef { session, id }` | Identify updateable content and tool relationships. |
| `SubagentId` | Identify a relationship within its parent thread across child inputs and runs. It does not establish an assignment identity or require an accessible child context. |
| `NativeInputRef { session, id }` | Address a real native input for lookup or retraction when supported. |

IDs use distinct branded string types. Consumers can serialize them but must not interchange them, parse prefixes, or infer lifetime from formatting. The host supplies `InputId`; adapters return native/context/content references. Validate storage and transport data before restoring branded IDs. The host assigns a stable `backendId` namespace and ensures a single writer for it; v0 adds no interprocess lock.

`SourceRef`, epoch, revision, and sequence stay internal to source mapping and ordering. Transport attempt identifiers, if needed, cross-process projection revisions, and subscription replacement markers belong to the host; this does not require a persistent attempt table. There is no universal call context or cancellation signal that conflates stopping local waiting, interrupting native work, and ending observation.

An adapter normalizes content once per shared source. Reobserving that live source preserves item identity. Pi currently assigns live message identities and resets its mapping on rebinding/compaction; they are not persistent history keys. Durable can derive saved item identity from native entries but uses an ephemeral epoch for previews. A known mapping can emit `replaces`; otherwise `gap` plus a replacement snapshot marks the break. IDs from a lost mapping must not be guessed equivalent across runtime reconstruction.

### Keep the observation a readable source view

Common content contains text/reasoning message parts, tool calls with possibly incomplete `argumentsText`, and tool results with optional serializable `JsonValue`. It does not export SDK objects, UI chunks, or a native replay format. `complete` describes content completeness, not goal achievement. Foreground `Activity` says nothing about all background tasks or pending preflight.

A parent snapshot may expose `Subagent { id, parent, child? }` records. The current two adapters discover children from native ownership evidence, identify each relationship by the native child ID within its parent, and route available child threads through the same runtime. Host-owned cross-harness routing is a separate concern. A relationship survives child continuation and carries no assignment completion status. Missing `subagents` means discovery is unavailable; an empty array means none are currently visible, not that no child ever existed. Missing `child` means no independently accessible context is supplied. Parent observation does not recursively mix in child content or deliver results back to the parent.

Snapshots replace only that source's current view, never the host archive, another thread, or a child view. Current adapters provide `current-view`; the protocol also permits `live-only` and `retained-view`. None promises every historical branch. An observation starts with a snapshot, then uses `item.upsert`, `item.remove`, `input.changed`, `activity.changed`, `subagent.upsert`, `diagnostic`, `gap`, and `closed`. Upserts carry accumulated values, not arbitrary token chunks; item removal is not native context deletion. Execution and interaction events are not reserved placeholder variants in v0.

[ThreadFeed](../../../../packages/agent-runtime/src/observation.ts) clones the view and events, serializes delivery within each sink, and isolates observers. The sink can run before the `observe` Promise returns, so its thread and subscription context must be captured in advance. Registration confirmation does not mean that the consumer has persisted the first frame. A sink's awaited Promise applies backpressure only to that observer, not to synchronous native dispatch or other sinks.

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
| Submit | Roots use native prompt and preflight evidence; idle steering is not mapped to a direct native steer call. Managed children use the owner's message/continuation path with `steer` only. | Native transactional input admission; submit can enable the shared scheduler even if this input is rejected. |
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

### Desktop integration implementation plan

This section is the implementation target for the four boundaries: native child ownership, continued input, independent projection, and persistence/recovery. It extends the package contract into Cherry's host; it does not declare the desktop migrated. Common spawn/stop and host-owned cross-harness orchestration remain the separate [control follow-up](2026-10-18-agent-runtime-subagent-control.md#keep-common-spawnstop-as-follow-up-work).

#### Starting point and change ownership

The Pi root desktop path now runs `AgentChatContextProvider → AgentSessionRuntimeService → PiRuntimeDriver → PiRuntimeConnection → createPiRuntime`. The connection uses the common input and observation boundary; native Pi providers send model requests through Cherry's internal gateway. Existing background output finds a parent assistant row through `rootToolCallId`; output without that anchor is ignored, and child parts are persisted back into the parent row. Replacing the factory alone would preserve this ownership problem.

| Location | Planned change | Responsibility retained there |
| --- | --- | --- |
| [Common contract](../../../../packages/agent-runtime/src/contracts.ts) | Use existing thread, optional input, relationship, and observation contracts first. Add a field only after native evidence and a consumer require it. | No product rows, delivery journal, scheduler, or UI lane. |
| [Pi runtime](../../../../packages/agent-runtime-pi/src/runtime.ts), [projection](../../../../packages/agent-runtime-pi/src/runtimeProjection.ts), and [subagent owner](../../../../packages/agent-runtime-pi/src/subagent.ts) | Add verifiable input correlation and restore child access through its native owner. | Native sessions, child execution, result delivery, and typed Pi extensions. |
| [Durable runtime](../../../../packages/agent-runtime-pi-durable/src/runtime.ts) | Reconcile persisted input mappings and child ownership against native submissions/tasks before scheduler activation. | Native Harness/storage ownership and recovery semantics. |
| [Desktop Pi integration](../../../../src/main/ai/runtime/pi/README.md) | Reuse host configuration/materialization and bind native Pi providers to the internal gateway; replace execution and output routing incrementally. | Prompt, skills, MCP, approvals, shell environment, model policy, usage, and tracing. |
| [AgentSessionRuntimeService](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts) and its persistence modules | Own configured runtime instances, logical input delivery, and a projection per thread. `ThreadProjection.ts` converts live content inside the existing module. | Product lifecycle, authorization, persistence barriers, and integration with delivery/fork operations. |
| [Data schemas](../../../../src/main/data/db/schemas/agentSession.ts) and [data services](../../../../src/main/data/services/README.md) | Add context/child associations and necessary message-owned submission metadata using `DbService`, with appended migrations. | Product data transactions; no native execution or transcript parsing. |
| [useAgentSessionParts](../../../../src/renderer/hooks/useAgentSessionParts.ts) and shared IPC contracts | Address a context's projection independently of the parent assistant message. | Presentation and subscription; Main remains the persistence owner. |

The helper is owned by the existing lifecycle service, not a new singleton or a second execution engine. Native paths are resolved through `application.getPath`; cross-process schemas belong in `src/shared`. Persisted business reads use DataApi; submit, observe, interrupt, and recovery commands use IpcApi. Renderer input is authorized against the associated product session, not trusted merely because it contains a native ID.

#### Boundary 1: keep child lifecycle with its native owner

Discovery records a parent relationship; opening the child acquires access to its context. Neither operation creates an assignment or reports a result. Pi model tools and host child input must reach the same extension controller. Durable child access must retain the native conversation/task relationship; creating an unrelated conversation and submitting text does not implement a native subagent.

For Pi cold reopening, first restore the parent's saved subagent registry and delivery state, then resolve the child through that owner and its loader. Publish restored relationships even when no new `onSessionCreated` callback occurs. Loading a child file as an ordinary root would bypass continuation, stop, and reporting rules. If the owner cannot be restored, retain the historical relationship and fail the child open; the current concrete Pi handle promises input and cannot be treated as observation-only. Product history remains readable. Extend the Pi adapter's restoration path before making the desktop depend on it.

Keep result reporting in the Pi extension or Durable's native reporter mechanism. The projector never sends a completion back to the parent. Direct Durable child input does not create a reporter. Pi's suppression of automatic parent wake after a user stop is a Cherry policy to preserve when adding Durable reporting, not behavior guaranteed by the upstream example.

The later spawn/stop layer will expose owner methods shared by tools and host calls. It must distinguish child creation from initial input admission and retain a created child's identity when admission fails or is unknown. Stop must specify whether it affects the parent, the child's current work, or background descendants, and whether continuation remains allowed. Those decisions do not require a mandatory public spawn/stop interface in this integration.

#### Boundary 2: connect continued input to native evidence

For message-backed input, Main reuses the new user-message ID as `InputId` and captures one immutable `InputDraft` addressed to the child or root thread. The public contract does not require other callers to have a product message. Save the message and the private submission information needed by actual consumers before dispatch; collect the result in Main even if the window or caller stops waiting. A permitted retry of the unchanged draft keeps its identity; an edited or explicitly rerun message gets a new one. Admission, placement, answer attribution, and terminal outcome remain separate evidence.

| Evidence needed by Cherry | Pi implementation gate | Durable implementation gate |
| --- | --- | --- |
| Admission | Preserve preflight and owner-controller receipts, including locally handled commands and late acknowledgement. | Associate the message with its captured target, stable deduplication key and confirmed native Submission identity where needed. |
| Placement and output attribution | Carry input correlation through hooks, native queues, history insertion, and child continuation. Do not match by text or queue position. | Reconcile native submission placement and run input sets; several inputs may contribute to one answer. |
| Terminal product state | Associate native completion, error, abort, or truncation with the affected input set. A settled session or complete assistant item alone is insufficient. | Map native done/unanswered/abort evidence without treating admission or foreground idle as successful completion. |
| Recovery of an uncertain attempt | No automatic retry without durable deduplication; preserve uncertainty when correlation was lost. | Use lookup and the original immutable draft under native deduplication rules; lookup failure cannot revoke known admission. |

Unpatched Pi 1.3.0's `PromptOptions` has no caller correlation token, and its steering/follow-up bookkeeping uses text. The first P0 slice now adds native caller correlation through transformed input, queues, history placement, and owner-managed child continuation. Cherry carries that change in a pinned dependency patch while the linked Pi checkout holds the source and regression tests; it is not an upstream release. The [evidence note](../testing/2026-10-17-agent-harness-evidence.md#p0-input-correlation-check--2026-10-19) records its validation and limits. The token does not alter transcript content, provide deduplication, or survive reopening by itself.

P0 now has package-level terminal and many-input attribution evidence. The Pi patch snapshots unanswered placed inputs at native request preparation and emits `input_settled` with the actual response entry after a final reply or terminal settlement. Tool/boundary continuations and retries retain the batch; queued or later-placed inputs cannot inherit an earlier response. The typed Pi `input-settled` event preserves native entry ID, input IDs, stop reason, and abort evidence. This is native response attribution, not proof of semantic task success or literal input consumption after arbitrary context hooks. The desktop path still waits for P1–P4 integration gates.

The common addition is optional `InputState.response: ItemRef`: several inputs can share the same terminal response without inventing an execution ID or assigning one `MessageItem.inputId` to an assistant answer. Pi supplies native batch evidence; Durable supplies each submission's answer entry. The reference follows current-view identity/coverage rules and is not a universal persistent history key. Normal final replies yield `completed`, errors `failed`, interruption `aborted`, and truncation or no final answer `unanswered`. Durable's native `done` also covers truncated/tool-only answers, so its adapter reads the actual answer before declaring success. Missing evidence keeps outcome absent. A handled command can fail without an assistant answer; late receipts must preserve established terminal facts. Finalize product delivery only after its corresponding projection and terminal evidence have been persisted.

`whenBusy` remains input admission policy. Non-waking notification, answering an interaction, and changing model/configuration are separate owner operations; none is encoded as another spelling of `steer`. This plan adds no universal interaction/tool interface.

#### Boundary 3: project each thread independently in Main

##### P3 starting point and ownership

P3 first uses Pi to validate the host path shared with later Durable and Claude Code adapters. The existing [ThreadProjection](../../../../src/main/ai/agentSession/ThreadProjection.ts) is an append-only UI-chunk converter: it marks every snapshot item ended, ignores removal/replacement, and rejects changed prefixes. It is not yet the current-view reducer described here. [Pi child observation](../../../../src/main/ai/runtime/pi/PiRuntimeConnection.ts) now routes child content through an independent projection; the existing root converter and small task-card metadata retain their current paths.

The P3-A core now exists as [ThreadMessageProjection](../../../../src/main/ai/agentSession/ThreadMessageProjection.ts). One instance accepts one Thread's observations, exposes a committed `CherryUIMessage` baseline and publishes changed messages, removals, order and state. It serializes updates and observation replacement, fences retired callbacks, reuses per-message SDK readers, and detaches a failed subscriber without stopping native work. Closing the projection stops its observation and readers; it does not release the native handle or interrupt execution. Its message IDs remain source identities within that Thread: product archive IDs and durable mapping belong to P3-B. Pi desktop child rendering now adds P3-B/C ownership, persistence and routing around this reducer; root now shares the desktop delivery contract described below; Claude Code native flow migration remains separate.

The old flow already pushes through shared cache with throttling. Child content lives inside parent message parts; background accumulation and publication cover the whole parent; continued output, recovery and finalization depend on the parent message's lifecycle. These are host ownership choices, not AI SDK requirements. Full-message copying has a cost, but no measurement here establishes it as the dominant bottleneck. P3 changes ownership and update granularity, with performance verified against the existing flow.

[#20389](https://github.com/CherryHQ/cherry-studio/issues/20389) records lost stream identity when rebuilding from saved parent parts; [#22482](https://github.com/CherryHQ/cherry-studio/issues/22482) records continued enqueue after reader failure, without proving the same initial cause. P3 removes the child's dependency on the parent's accumulator and tests failure recovery separately.

Use one host projection owner per `(backendId, threadId)` within its configured runtime. It owns the adapter handle, observation, current view, source-to-product item mapping, and pending persistence. It stays inside the existing Main lifecycle owner. Renderer windows subscribe to that view; opening a second window does not create a competing native projection or persistence writer. Root and child use the same reduction rules, while retaining their own captured archive destinations.

```text
Parent Thread observation -> parent projection -> parent display
          Subagent link ----------------------> child display link
Child Thread observation  -> child projection  -> child panel / tool card
                            |
                            +-> child context's product messages
```

The child's content belongs to an independent product archive associated with its context, with its own message identities and tree root. A parent tool card holds the relationship and a presentation link, not the child's only durable storage location. Parent turn completion, removal of its live assistant accumulator, and closing its view must not stop child observation. `toolCallId` remains launch/resume provenance, not child identity. A UI lane is a Cherry view grouping derived from this association, not a harness execution identity. Background shell output is not automatically a child Thread.

A child relationship without `child` remains a readable relationship/result card. Open an accessible child separately, and expose input only when the new access and product authorization allow it. Historical links, foreground idle, and observing a completed message grant neither control nor proof that a task succeeded. Continued input still uses Boundary 1's native owner; the projector never prompts, retries input, or reports completion to the parent.

##### Reduce observations as state

The Main reducer consumes `ObservationPayload` and produces changed items/relationships and the current source view, without calling native controls or writing the database. Map that content into the shared product message model. Existing public fields are sufficient for this slice; do not add a mandatory replay cursor, lane, or history API.

Chat, root agents and child agents share [CherryUIMessage and CherryMessagePart](../../../../src/shared/data/types/message.ts) for product content, persistence and rendering. Runtime `ContentItem` and thread relationships describe source facts; they do not introduce a second UI message schema. Reuse the existing stream-management and lifecycle infrastructure; P3 does not require retiring `AiStreamManager` or building a parallel stream manager.

Reuse `readUIMessageStream` for live `UIMessageChunk` accumulation per message, including observation updates that can be represented by valid chunks. It supports incremental updates and emits successive message snapshots; the pinned version clones the message when emitting. This does not require full-parent IPC broadcasts or persistence writes. A thread can contain several messages; it must not become one ever-growing message accumulator.

The same Main owner coordinates live reader output and snapshot/history replacement into the shared message state. Saved parts are not a checkpoint of the reader's active-part identities. On replacement or recovery, fence the retired reader before applying the new baseline and establish a valid continuation sequence; do not let late snapshots overwrite restored state or feed deltas into a reader missing their start frames. Window reattachment subscribes to the existing Main view without rebuilding that reader. This coordination supplements the SDK parser rather than reimplementing its token accumulation.

| Observation | Current-view rule | Archive and control boundary |
| --- | --- | --- |
| Initial or replacement `snapshot` | Replace only this source view. Honor each item's `completeness`; partial items remain updateable. Preserve the declared coverage. | Do not append the snapshot as a new transcript, delete older saved messages, or mark every item finished. |
| `item.upsert` | Replace that item's accumulated value, including shortened or changed text and incomplete tool arguments. Equal updates are idempotent. | Update an established product mapping; no token rows or text-based deduplication. Map multiple content items to a message only with evidenced grouping. |
| `replaces` / `item.remove` | Retire the named items from this view. Apply replacement and insertion together, using source-scoped identities. | A replaced preview may transfer a proven mapping; removal alone never deletes historical rows or merges unrelated completed messages. |
| `input.changed` / `activity.changed` | Update input evidence and foreground activity independently from content. | Preserve confirmed saved receipts/outcomes across view resets. Idle or complete content does not settle an input; finalization still needs its response association and persistence barrier. |
| `subagent.upsert` / snapshot relationships | Upsert parent-scoped relationships and discover accessible children without mixing their content into the parent view. | An omitted/empty current list does not delete saved relationships, terminate children, or revoke all historical links. |
| `gap` | Mark discontinuity. After mapping loss, await a replacement baseline before applying changes through a new mapping. | Retain saved history and start reconciliation; never silently concatenate new identities into an old stream. |
| `diagnostic` / `closed` | Record the diagnostic or unavailable observation; preserve the last readable view. | Observation failure is not native task failure or permission to resubmit. A best-effort `closed` callback is not a flush acknowledgement. |

Validate item and relationship scope against the captured thread. A sink/reducer failure detaches the failed consumer, records a bounded diagnostic, and permits explicit observation recovery; it must not keep enqueueing into an unusable reader or fail another thread's projection. Reattachment does not create another execution.

##### Separate current-view delivery from durable product history

The sink reduces frames promptly and schedules coalesced persistence without awaiting database/IPC work inside each callback. Keep only the latest pending accumulated value for an already mapped item, while preserving accepted identity transitions and terminal evidence until their writes finish. Bound pending work and report archive failure rather than creating an unbounded replacement event queue. This reduces pressure; it does not make `ThreadFeed` lossless. A synchronous burst can still exceed its pending-frame limit before the consumer runs.

P3 has two recovery obligations: a replacement snapshot makes the UI current, while native evidence reconciles committed content into the product archive. Pi supplies a typed `handle.pi.archive()` facet with native entry IDs and live aliases proved by native message identity; inherited parent context is excluded at the `subagent-origin` boundary. `PiRuntimeConnection` reads that facet and injects committed `ContentItem` data into `ChildThreadProjection`. The host projection consumes public `ThreadHandle` observations and never imports Pi types or dispatches child input. No mandatory public Runtime history interface is added. Do not decode `live:*` IDs, match text/position, or reach through private session fields; other adapters must provide their own evidence.

Reconcile only the bound child and its proven history range, on first attachment, a gap/mapping reset, terminal settlement, or reopening. This is not periodic transcript polling or a bulk import of every native branch. Native-history reads and observation updates need a captured native boundary and serialized merge so a concurrent completion is neither skipped nor imported twice. Reuse a saved product ID only when the native association proves it. Unknown mappings preserve the archive and show the new view with a visible discontinuity; they do not silently establish complete history.

Known product mappings, native entry associations required for reopening, and a discontinuity that affects later history reads are Main-owned persisted facts. Source epochs, host revisions and transient preview keys remain private delivery state, not permanent history IDs. Compaction may change the current view without deleting product history. A final native entry can replace its proven partial projection; intermediate token revisions are not archived separately. Partial output that neither native storage nor Cherry committed before a process crash is not promised recoverable.

Save final response content, its product mapping and known input outcome together before declaring product delivery complete. A DB failure retains pending facts for a bounded retry/explicit recovery and keeps product finalization unresolved; it never repeats the model/tool operation. Native result reporting remains with the harness and does not wait on a second host-generated report. Durable and Claude Code will need their own evidence for the same archive boundary, not copied Pi entry semantics.

##### Attachment, persistence and lifecycle barriers

Capture the thread, archive destination and subscription replacement marker before calling `observe`: the sink can run before registration resolves. Keep one serialized writer per thread. Replacing an observation seals its ingress, calls `stop`, waits for already-entered consumers and accepted writes to finish against their captured destination, then publishes the new source mapping. `stop()` alone does not drain an asynchronous sink. Late callbacks from the retired marker cannot change the new view. Failed draining blocks a successful handover instead of starting a competing writer.

Main sends the shared message view and host revision at Renderer attachment, then only affected messages or parts with ordered revisions. Capture the attachment boundary and register subsequent delivery in the same serialized operation. Repeated/stale delivery is ignored by revision; a missing revision requests a replacement view. These transport revisions stay outside `agent-runtime` and are not archive commit receipts. Unchanged child/parent views keep stable references; ordinary child updates neither publish the full parent parts nor refresh the complete session through DataApi. DataApi remains the path for saved history; IpcApi carries live observation and control.

For a proven text append to the same mapped part, the host transport sends only the added text with its target and revision. Changed prefixes, part reordering or identity replacement send a replacement for the affected message/part instead. Delivery patches update the same `CherryUIMessage` state; they are a transport representation, not another message model or a second token parser. Normal long output must not repeatedly serialize the entire accumulated child transcript merely because its parent is now independent.

Persist partials in batches to the same product rows; flush on content settlement, observation replacement and coordinated shutdown, without equating content completeness with input success. Restore a saved archive plus its evidenced live mapping on reconnect instead of replaying its text into a chunk parser. Parent tool cards and child panels consume the same child projection and existing shared message components; they do not each hold a parser or persistence writer.

Final native-history reconciliation must have a readable boundary. Pi's typed `archive()` remains readable after native shutdown until that access is released; command/input access is sealed. The connection quiesces native execution, flushes committed child content and product mappings, then releases handles. A failed flush remains unresolved and can be retried without repeating native shutdown. This does not promise token recovery after forced process loss, or apply automatically to Durable/Claude Code; each adapter must prove its handoff without using a native wait that might start scheduling.

| Product action | Host behavior |
| --- | --- |
| Window closes or changes selection | Detach that subscriber; retain the Main observation needed for active work and persistence. |
| Parent finishes, child continues | Keep the child's projection and native owner reachable independently of the parent message. |
| User stops generation | Seal relevant host delivery, request the documented native interrupt, and track its result; do not substitute `release` or claim all queues are empty. |
| Last view releases | Detach that subscriber. In the initial implementation, retain the Main observer with its runtime owner; foreground idle alone does not prove that no autonomous child work can follow. |
| App exits or an execution environment is retired | Seal admission, collect in-flight receipts, preserve observation during native shutdown, reconcile final persisted content and drain/fence projection writes before closing the database. A missing terminal callback or failed flush cannot count as confirmed clean completion. |

For the first Pi integration, scope the runtime to a product session's native root and owned child tree; keep all its handles behind that owner. Durable scope follows its exclusive native storage/Harness, which may contain several conversations. Do not apply the legacy per-message or per-connection idle TTL to a single conversation inside either owner. The initial policy retains the configured owner and opened Main observations until explicit retirement or app shutdown; memory growth is a known limit. Releasing idle observations or evicting threads needs a proven native rediscovery/recovery path and separate validation.

##### Shared desktop observation for root and child

Independent child ownership does not require a child-only delivery protocol. Root and child now share `ai.projection.attach/detach/changed` and the Renderer projection store, retaining separate projection instances, native owners and archive destinations. This changes desktop observation, not the public Harness interface or the native root converter. The overall Spec remains proposed pending its wider acceptance gates.

The root producer already exists: [pipeStreamLoop](../../../../src/main/ai/streamManager/pipeStreamLoop.ts) accumulates messages with `readUIMessageStream`, and [AiStreamManager](../../../../src/main/ai/streamManager/AiStreamManager.ts) receives snapshots through `onAccumulatedSnapshot`. Publish from that boundary without another reader. Child owners publish mapped messages after `ThreadMessageProjection` and archive reconciliation; do not convert them back into chunks for Renderer to parse again.

```text
AiStreamManager snapshots -----> root view publisher --+
ChildThreadProjection messages -> child view publisher -+-> shared projection IPC
                                                         -> Renderer projection store
                                                         -> existing message views
```

| Boundary | Concrete change |
| --- | --- |
| Shared contract | Snapshots, patches, ordering and revision application live in [messageProjection.ts](../../../../src/shared/ai/messageProjection.ts). Keep `CherryUIMessage`; carry owner-specific activity, availability and terminal facts as typed state rather than deriving them from content. |
| Main publication | Share diffing, batching and subscriber delivery. Keep child native mapping/reconciliation and archive writes in `ChildThreadProjection`; keep root execution and terminal persistence in `AiStreamManager` and its listeners. Each view captures its owner and destination. |
| IPC | Use common attach/detach/changed operations under `ai.projection.*`. Resolve existing root/child addresses with owner authorization; `toolCallId` is only a child lookup input. Subscription identity is transient delivery state, not a new persisted relationship. Input, approval and interruption remain owner-routed commands. |
| Renderer | Share a subscription store and patch reducer. Make `useAgentChildProjection` and `useExecutionOverlay` view-specific facades; retain stable references, batched notifications and terminal-to-DB handoff. Two views must not create two native readers or writers. |

The baseline is complete only for its declared scope: a root live overlay does not replace saved topic history, and a child view excludes its parent and siblings. Root routing retains the captured topic, execution attempt and message anchor, including parallel models and continuation. Reusing a model/execution ID alone cannot route a late update into a newer attempt. Owner state and its content must cross a consistent revision boundary; idle, unavailable or detached observation never proves successful input completion.

Use the attachment and persistence barriers above, with these transport constraints:

1. Listen before attachment, buffer early updates within a bound, install the baseline and apply uncovered updates. Fence late attachment results and callbacks with subscription identity. Main captures the baseline and registers subsequent delivery in one serialized operation.
2. Assign contiguous revisions to published batches after coalescing. Ignore covered revisions; apply only the next one. A gap, invalid patch or overflow obtains a fresh baseline. A publisher is not replaced under an existing subscription: root publishers remain while observed, and child closure publishes unavailable before releasing delivery. Reopening attaches to the current owner with a new subscription identity and baseline, fencing the old revision domain. Automatic rebinding of a closed native owner is outside this transport change.
3. Flush accepted content before terminal publication and retain the root persistence-before-notification barrier. A terminal attachment includes its final baseline instead of closing before buffered content is represented. Write failure retains the readable view and unresolved delivery; detach never interrupts native work.
4. Bound pending delivery and replace the baseline when a subscriber falls behind; never silently drop numbered batches. Current-view recovery needs neither TCP-style acknowledgements/retransmission logs nor a new archive table. Existing chunk sequence numbers cannot substitute for revisions because chunk coalescing and splitting do not produce contiguous delivery batches.

First fix the existing replay/terminal handoff in [#22413](https://github.com/CherryHQ/cherry-studio/pull/22413), covering terminal attachment responses and a replay buffer that no longer covers queued live chunks. Shared projection delivery does not repair consumers still on that path. Deliver this migration in a focused follow-up above the P3 child PR, covering AC17–AC18; a child API rename alone does not complete it.

Both real producers and their desktop consumers use the shared path. [ExecutionStreamOverlayService](../../../../src/renderer/services/aiTransport/ExecutionStreamOverlayService.ts) consumes Main snapshots; [useChatWithHistory](../../../../src/renderer/hooks/useChatWithHistory.ts), Quick Assistant and Selection use [useStreamCommands](../../../../src/renderer/hooks/useStreamCommands.ts) for input, stop and errors. The old `IpcChatTransport`, `TopicStreamSubscription`, child-only observation routes and duplicate Renderer readers are removed. Main SDK accumulation and raw listeners with remaining consumers stay. Claude Code's native adapter migration and Durable host integration remain separate work.

Local implementation verification covers published revisions, baseline/live overlap, duplicate delivery, gap and overflow recovery, old-subscription fencing, shared leases, parent/child isolation, model retry fencing, terminal content, host approval decisions and the persistence success/failure barrier. It also covers all four desktop consumer components. A fresh isolated Electron run with Claude Sonnet 4.5 exercised Home Chat (185 updates, 181 appends), Pi root and same-child continuation after parent completion (74 child updates, 70 appends), Quick Assistant, Selection, saved-history reload, and stop followed by a new request. These observations verify delivery behavior, not a comparative performance claim. Two legacy `subagentWake` tests also fail on the clean P3 parent checkout and remain a separate known issue. P3 continuation-order, crash/recovery and comparative performance gates remain open.

#### Boundary 4: persist product associations, recover native state

##### Storage decision and scope

P1 uses `DbService` for Cherry's context associations and necessary message-owned submission information. It does not add `agent_session_input` or a general host input journal. Pi keeps native session files; Pi Durable uses its native SQLite storage in a separate file. Each harness owns its serialization, commits, and recovery. Cherry owns the location, lifecycle, and product associations. These are Main-private host records, not additional public `agent-runtime` interfaces.

The current [message schema](../../../../src/main/data/db/schemas/agentSessionMessage.ts) already stores display content, search text, runtime resume tokens, and cross-session delivery fields. The [session schema](../../../../src/main/data/db/schemas/agentSession.ts) has no explicit native context association. The [old Pi loader](../../../../src/main/ai/runtime/pi/PiRuntimeConnection.ts) can initialize a session when a token has no flushed file. P1 preserves existing history while establishing explicit associations; migrated contexts use strict opening.

| Data | Authoritative owner | Physical storage and consumers |
| --- | --- | --- |
| Model history, branches, compaction, native queue/task/reporter state | Harness | Pi `SessionManager` files or one native Durable store. Native execution and recovery consume them. |
| Backend location, product/native context association and necessary submission facts | Cherry Main | Backend/context records and Main-private metadata on the existing user message in `DbService`. Runtime coordination and recovery consume them. |
| Product-visible messages, search, usage, display metadata | Cherry message service | Keep `agent_session_message` during native adoption; reuse the existing `topic`/`message` tree semantics in a separate product migration. Renderer and product queries consume it. |
| Streaming partials, observer revisions and current item mappings | Main projection owner | Memory, with coalesced updates to the same display rows. These are not a native event archive. |

Some text exists in both native history and display messages because the two records have different retention and consumers. Native compaction or branching cannot delete the product archive; product edits cannot silently rewrite the model's native context. Do not store a third complete transcript or mirror Durable entries/submissions/tasks/commits into Cherry tables. Keep the submitted message version stable instead of copying its body into a mandatory input record. If a future retry consumer requires a transformed payload that the retained message cannot reproduce, justify a private payload snapshot for that path; do not infer that every input needs one.

```mermaid
flowchart LR
    Host["Main runtime coordinator"]
    Adapter["Pi / Durable adapter"]
    Native[("Native session files / Durable SQLite")]
    Projection["Main thread projection"]
    subgraph CherryDB["Cherry SQLite / DbService"]
        Records["Backend and native associations"]
        Messages["Product messages + private submission facts"]
    end
    Host --> Records
    Host --> Adapter
    Adapter --> Native
    Adapter --> Projection
    Projection --> Records
    Projection --> Messages
```

##### Reuse the product message tree

The existing [message tree](../../../../docs/references/chat/message-tree.md) uses `topic`, `message.parentId`, and `topic.activeNodeId` for message ancestry, edits/resends, and branch selection. Ordinary chat also builds model history from the selected path. Reuse that product structure rather than introduce a second tree of contexts. `agent_session_message` now retains its own physical table while sharing those tree semantics: one hidden root, `parentId`, and `agent_session.activeNodeId`. This does not switch desktop execution to the common Runtime.

| Relationship | Owner and representation |
| --- | --- |
| Message continuation and alternative conversation branches | Product message tree and its existing branch selection. |
| Product position to native execution position | A binding containing the backend, native session/thread identity, and checkpoint where needed. |
| Parent agent to spawned child | A distinct derivation relationship, native ownership, and an input target when access permits; ordinary message `parentId` does not express these semantics. |

A product branch is not necessarily a native session: Pi's `SessionManager.branch()` can branch inside one session. Keep `Context` limited to native association, not a second message container or branch hierarchy. Before P2 integration, first evaluate binding at the session or branch anchor; per-message `contextId` needs a concrete projection consumer before being added. Resolve the selected product branch to its native target without maintaining a competing branch selection in `rootContextId`. A binding locates native state; it does not reconstruct that state from product messages.

Child content can reuse message storage and tree rendering, but nesting it under a parent in the UI does not make its independent history, tools, lifecycle, or input target part of the parent's ordinary conversation path. Preserve the separate spawn relationship and native owner before routing continued input. P1 does not require either `agent_session_message.contextId` or `agent_session.rootContextId`; settle binding placement and migration before finalizing those columns.

##### Current product model and the migration boundary

The following inventory is source inspection, not completed integration:

| Concern | Current ordinary chat | Current Agent path | Proposed boundary |
| --- | --- | --- | --- |
| Container and navigation | `topic` owns assistant selection, name, ordering, activity, trash, and `activeNodeId`. | `agent_session` mixes conversation metadata with agent/workspace binding, schedule reuse, and `conversation`/`background` classification. | Keep existing IDs and navigation owners during runtime cutover. Separate explicit conversation membership under [#20635](https://github.com/CherryHQ/cherry-studio/issues/20635); runtime access must not imply sidebar membership. |
| Message structure | `message.parentId`, one virtual root, sibling groups, and selected-path reads. | `agent_session_message.parentId` and a hidden root define ancestry; `agent_session.activeNodeId` selects a path. A Seeder links old flat rows in `(createdAt, id)` order. | Reuse the message-tree contract for Agent archives. Do not use native contexts as substitute message nodes. |
| Editing and fork | Product tree operations select or create alternative paths. | [Edit](../../../../src/main/data/services/AgentSessionMessageService.ts) creates and selects a sibling input after native fork publication, retaining the old tail; [fork](../../../../src/main/ai/agentSession/fork/AgentSessionForkOperations.ts) publishes another product session and copied prefix. | The confirmed target behavior retains the old branch and selects the edited branch. Ship it with the corresponding UI/action change. Explicit “fork into a new conversation” remains distinct. |
| Native location | Ordinary chat assembles model history from the selected path. | Message rows retain native provenance; `agent_session_context` binds root/branch anchors to native identity, published head, and fork checkpoint mappings. | Persist verified native bindings; preserve historical checkpoints. The selected display path cannot reconstruct a harness. |
| Trusted product state | Shared message content, snapshots, usage, and attachments. | Additional Main-authored `delivery*` state and native checkpoint evidence. | Preserve Main-only writes and cross-session delivery semantics; shared message editing must not accept these fields. |
| Dependent records | Chat attachment references and topic navigation/search. | [Agent attachment references](../../../../src/main/data/db/schemas/fileRelations.ts), usage `messageKind`, session pins, task/channel bindings, and saved routes. | A table merge must migrate every consumer. Identical-looking content columns do not establish interchangeable ownership. |

Recommended first landing: share tree semantics and the existing [message UI contract](../../../../src/renderer/components/chat/messages/README.md), while retaining the two physical archive tables and their owning services. Agent reads/writes remain behind Agent APIs; shared components do not call Home topic mutations. Extract only tree operations with actual consumers in both services. This preserves one content writer per archive and avoids coupling native adoption to a navigation/table rewrite.

Physical consolidation into `topic`/`message` is a separate migration decision. Simply assigning a topic to every execution would make background or child history look like user conversation membership. That decision must specify the owner of hidden archives, native checkpoints and delivery state, and the treatment of session routes, pins and attachment foreign keys. #20635 initially specifies one-to-one conversation membership; this proposal does not silently expand that issue into a many-to-many conversation model.

##### Confirmed edit and branch behavior

The user confirmed that editing and resending retains the old branch and selects the new one. The desktop driver now implements this behavior and routes Pi root execution through the common Runtime; independent child projection remains a later step.

```text
root
└── U1 → A1
    ├── U2  → A2       (retained)
    └── U2' → A2'      (selected)
```

The edited input gets a new message ID and logical input ID, with the same predecessor as the original input. The common prefix remains shared in the product tree; existing messages, input facts and native bindings are not rewritten. Native fork starts at the verified boundary before the edited input, not after the old answer. The new branch gets its own binding. Explicitly forking into another product conversation still copies the prefix with new product IDs and a native checkpoint mapping.

Editing the first input has an empty prefix. Record an intended native identity and create the new Pi context lazily on dispatch with the action's validated configuration, without requiring a nonexistent pre-input checkpoint. This is a new branch operation, not fallback reconstruction of a missing context. For a nonempty prefix, a missing checkpoint still blocks execution; display text cannot substitute for it.

Publish the new branch and selection only after the native result is verified and the source version still matches. Before publication, failure leaves the old selection/history intact. After publication, a rejected or uncertain submission remains visible on the new branch with its actual state; do not delete that branch, restore the old tail, or resend automatically. Preserve the current guard against editing a source with unsettled work until a separate action defines how to interrupt or fork it safely. Opening or selecting the retained branch never resubmits its input.

##### Minimal host model and branch routing

The diagram describes logical relationships, not seven new tables. “Archive” means the existing product-owned message store; the initial Agent implementation keeps `agent_session_message`.

```mermaid
flowchart LR
    Membership["User conversation membership"] --> Archive["Product message tree"]
    View["Selected message / activeNodeId"] --> Archive
    Archive --> Anchor["Root or branch anchor"]
    Anchor --> Binding["Verified native binding + published head"]
    Binding --> Thread["Thread: backendId + native id"]
    Input["Message-owned submission facts"] --> Binding
    Input --> Reply["Optional evidenced response message"]
    Parent["Parent native context"] --> Relation["Subagent ownership relationship"]
    Relation --> Child["Optional addressable child context"]
    Child --> ChildArchive["Independent child archive"]
```

| Fact | Proposed placement and invariant | Consumer that needs it |
| --- | --- | --- |
| Product owner and selected path | Existing container plus product `activeNodeId`; add Agent tree support using the same virtual-root and parent rules. Selection is not an execution cursor. | History, branch navigation, and the composer. |
| Message ancestry | Product `parentId`, with same-owner validation, one root, and no cycles. It describes the displayed path, not proof that a model consumed every ancestor. | Existing message-tree views and branch operations. |
| Native storage identity | Existing proposed `agent_runtime_backend` and verified native thread identity. | Strict open, ownership, backup, and cleanup. |
| Branch-to-native binding | Existing proposed context record associates the product root or branch anchor with a native thread. A confirmed binding preserves its native identity; another native context gets another binding. | Resolve the destination of a new input without consulting a global “latest token.” |
| Published execution position | Main records the product head associated with confirmed native progress and keeps opaque checkpoints at supported boundaries. It is separate from the user's selected node. | Decide whether input continues the native head or requires a fork; fence late projections from another branch. |
| Logical input | Reuse the user-message ID and retained submitted content. Main-private metadata captures the target/anchor and only the receipts or optional response association required by consumers. It is not another message container. | Busy submission, late acknowledgement, recovery, and many-input/one-response attribution. |
| Child relationship | Parent-scoped subagent identity, native owner, optional child context and its archive. | Independent observation and owner-checked continued input. Browsing history does not grant control. |

Resolve input in Main from an explicit product owner and anchor captured when the action starts, not from a later read of `activeNodeId`. Find the published binding on that path, verify ownership and checkpoint compatibility, and reconcile pending native facts. If the selected position is the binding's writable head, submit to it. If it is a historical position, prepare a native fork before publishing a writable branch. If the checkpoint is missing or the operation remains uncertain, keep the history readable and reject that execution action; never fill the gap by replaying display messages.

The sparse anchor binding and published head are the facts to establish in P1/P2; their exact columns belong to the selected storage implementation. They do not require a `contextId` on every display row. A checkpoint is a resumable position, not proof that the newly forked context originally authored the copied prefix. Preserve explicit fork mappings without rewriting historical authorship.

For the initial writable-branch implementation, prefer independent native forks through the existing checkpoint/publication owner. Pi can navigate branches within one session, but sharing that mutable native leaf across simultaneously active product branches requires additional coordination that the current adapters do not expose. Viewing a branch never switches that native leaf. Multiple inputs can share one response, so the input-to-response association remains separate from the message tree's single-parent edges.

##### UI actions to Main and harness operations

Current Agent send/edit wiring lives in [useAgentChatRuntimeState](../../../../src/renderer/pages/agents/useAgentChatRuntimeState.ts), [AgentChatContextProvider](../../../../src/main/ai/streamManager/context/AgentChatContextProvider.ts), and the [AI IPC handlers](../../../../src/main/ipc/handlers/ai.ts). The following is the target mapping. DataApi owns stored product reads/writes; lifecycle/native commands go through Main coordination. Renderer supplies product IDs and intent, not raw native locators.

| UI action | Product/Main operation | Harness operation and boundary |
| --- | --- | --- |
| Create an empty conversation | Create/reuse the product placeholder and workspace association. | Native creation may wait for first input. Do not pre-create a file merely to display an empty conversation. |
| Open a conversation or reconnect a window | Read its archive, resolve the binding, attach an observation if available. | Strict `open` then `observe`; no implicit input, fork or Durable `resume`. Missing native state does not hide the archive. |
| Select another branch or historical node | Update the product selection and load that path. | No native mutation. An active source keeps writing to its captured branch, even if the window selects another one. |
| Send at the current native head | Persist the user message and required private submission information; capture target/anchor before native dispatch. | `handle.input.submit` using a supported policy; persist receipts separately from completion. |
| Send while busy | Keep the captured target and the selected supported `whenBusy` policy. A queued draft cannot follow a later branch switch. | Native admission decides reject/steer/follow-up. Hooks and commands retain their earlier handling boundary; do not emulate atomic idle admission. |
| Edit and resend, or continue from history | Validate the source version/checkpoint, prepare the native branch, then publish new branch/binding and input. Keep the old path and select the new one. | Typed native fork, or explicit create at an empty root, followed by submit; unsupported history actions remain unavailable. Ordinary history selection must not invoke it. |
| Fork into a new conversation | Reuse the existing coordinated file/checkpoint publication and workspace policy; create independent product membership and a copied prefix. | Native fork, not another root `create` populated from UI text. The source keeps its own execution. |
| Regenerate a historical answer | Treat as an explicit branch from a verified boundary, with a new logical input where applicable. | No universal “rerun answer” guarantee; expose only when the adapter and product action define the exact replay boundary. |
| Stop the visible execution | Resolve the captured execution target, distinguish pending host input from admitted native work, and report actual stop scope. | Optional `interrupt`; it is not `release`, deletion, or guaranteed cancellation of every child. Durable interrupt can enable Harness-wide scheduling. |
| View or message a child | Read its independent archive; resolve the relationship through its owner and validate input access. | Separate child `open`/`observe`; submit only if the handle exposes input. Pi continuation goes through its parent controller. Observation does not report a result back to the parent. |
| Close a window or tab | Detach its observation/access; retain Main's pending writes, receipts and other owners. | `Observation.stop`/`release`; no implicit native stop or history deletion. Application shutdown belongs to the runtime owner. |
| Rename, pin, archive, or delete | Metadata stays with product owners. Archive/purge uses lifecycle coordination; protected bindings and in-flight delivery cannot be bypassed by a shared tree delete. | No native call for ordinary metadata. Product deletion is not automatic store deletion; native purge needs retained-reference and active-work checks. |

Shared UI actions remain capability-driven. The current common `InputDraft` carries text only; existing rich message parts, attachments, tool approvals, configuration changes and native commands still need their production adapter/host path. Do not claim full composer parity by flattening unsupported content to text or by adding all such actions to the mandatory runtime interface.

##### Pi and Durable checks for the proposed mapping

The linked Pi baseline is `8efd314fa3d3232ce197d8d7a6a5660530b9d83e` / 1.3.0. These findings establish native facilities, not host integration acceptance.

| Operation | Pi | Pi Durable | Remaining integration work |
| --- | --- | --- | --- |
| Existing-context open | Package `open` checks the loader's native session ID; the host must load the existing file strictly. | Package `open` looks up an existing conversation in its backend store. | Validate location/store identity before recovery writes; never create a replacement. |
| Continue from a historical position | Native `SessionManager.branch()` changes the same session's leaf; current Cherry [piFork](../../../../src/main/ai/runtime/pi/piFork.ts) uses `createBranchedSession` and returns remapped checkpoints. | Native [`Conversation.fork(at, options, context)`](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/harness/harness.ts) creates another conversation from an entry; ownership is specified separately. | Neither new Runtime adapter exposes fork yet. Extend a typed adapter history path using native facilities; do not add a mandatory common fork or manipulate adapter-private sessions from Main. |
| Continued child input | Owner controller enforces load/stop/reporting policy. | Child conversation can accept input; direct input does not create a reporter. | Restore ownership before allowing controls; keep result handoff separate from projection. |
| Reopen after exit | Saved native context can reopen; unfinished execution and in-memory queues are not recovered by opening. | Passive open/query precede explicit scheduler activation; submission or interruption can activate the whole Harness. | Real process-death tests and product lifecycle verification remain required. |

##### Four flows to validate before schema implementation

1. **First conversation and input:** create the product placeholder, including its virtual root once tree support is enabled; commit native-creation intent; create through the selected adapter outside the DB transaction; publish the verified binding; save the user message and necessary submission metadata, then submit. Pi's allocated session ID may precede file flush, so availability for reopening stays unconfirmed until supported evidence exists. Native success followed by a failed Cherry write is reconciliation work, not permission to create or submit again.
2. **Normal continued input:** capture the selected anchor and binding; validate the native head; persist the user message, required private metadata and projection placeholders; submit; reconcile receipts and events in any order. Final projection and evidenced input outcome commit together. Concurrent windows can select different paths without changing the captured input destination.
3. **Edit or branch continuation:** read a consistent source/checkpoint; prepare an independent native fork, or explicitly create at an empty root; recheck the source version; atomically publish the branch/binding and selection; only then submit the new input. An unresolved operation never publishes a successful branch or starts another native creation automatically. Old branches retain their bindings; copied history carries no new usage, approvals, delivery ownership, or child-control authority.
4. **Restart and branch selection:** restore product history and selected node first; validate backend/native identity and restore owner relationships; strictly open and observe; reconcile saved inputs and proven projection mappings; enable execution only after that. Selecting an older path is read-only. A later send at that path uses its confirmed head or explicit fork boundary. Unknown Pi admission remains unknown; Durable lookup/deduplication uses the original key and draft.

##### Native backend identity and location

Persist a small `agent_runtime_backend` record so contexts sharing one native namespace do not each own its path or independently close/delete its store. Its `id` supplies `backendId`; it survives process/runtime replacement. Store the harness kind and a versioned, Main-private locator. Credentials, provider configuration, and mutable runtime objects stay with their existing owners. `backendId` is not a process ID or a new public `Backend` interface.

For Pi, use the registered `feature.agents.pi.sessions` location and validate each loaded session header against the expected native ID. An optional relative file locator avoids scanning; it never substitutes for identity. Preserve existing files in place during association migration. Pi's allocated ID and `input-placed` event do not prove the lazy session file has reached durable storage. A context with no verified file remains unavailable for reopening; it is not silently initialized from display history.

For Durable, allocate a separate native SQLite file per configured backend. All conversations in that store share its Harness owner and scheduler scope. Prefer the existing 1.3.0 `openNodeSqliteStorage` implementation; the package test already uses it, while Electron availability and packaged loading still need P4 verification. Its optional table prefix does not make sharing Cherry's database transaction safe: `DbService` owns a synchronous better-sqlite3 connection, and Durable owns its own connection, transaction, schema, and failure lifecycle.

Durable numeric conversation IDs identify records inside a store, not the store itself. On explicit creation, persist the backend ID inside a Cherry-owned, session-scoped native document using Durable's existing `defineDoc` mechanism; validate it before binding conversations or allowing Harness recovery writes on reopen. A missing/mismatched marker in a previously bound store is unavailable access, not permission to initialize or relabel it. Creating the marker uses native storage, never raw writes to Durable's internal SQL tables. The Main native-context helper creates and validates this marker; it is not part of the common adapter interface.

Resolve paths only through `application.getPath`. Register the new Durable location under `feature.agents.*`; creation-sensitive lookups use the path registry's `NO_ENSURE` mechanism. Database-only work and strict `open` must not materialize missing native files. Native APIs that create missing files, including `openNodeSqliteStorage`, require a strict existing-file opening path before production use; an existence check alone does not close a check/open race. P1 first probes existing-only opening and identity reads before `Harness.open` performs recovery writes. Prefer native facilities; if the pinned APIs cannot satisfy this boundary, record the required upstream change before implementing the loader.

##### Host records and invariants

The following table separates new backend/native-association records from information kept with existing messages. P1 uses the existing Agent session owner; the tree step adds sparse branch anchors when consumed by routing. Physical archive consolidation is not a prerequisite. Drizzle types and names follow the repository conventions. Data services own their writes. Runtime coordination stays in the existing lifecycle owner.

| Record | Minimum stored facts | Invariant |
| --- | --- | --- |
| `agent_runtime_backend` | Stable backend ID, harness kind, versioned private locator, creation intent and confirmed native binding. | Native storage has one Main owner. Location changes preserve identity; opening never initializes a missing bound store. |
| `agent_session_context` | Product context ID, `sessionId`, backend ID, creation intent, optional confirmed native thread ID and private locator. | Unique confirmed association by `(sessionId, backendId, nativeThreadId)`; an unbound creation intent cannot be opened. This describes native association, not message ancestry. |
| Existing user message plus Main-private submission metadata | Reuse the message ID for `InputId` and retain its submitted content. Save the captured target/policy, native identity or confirmed facts only where routing, UI or recovery needs them; a stable Durable key can be derived from the message ID and passed explicitly. | Changing target, content or policy creates a new message/input. Several messages may associate with the same evidenced response; neither a response nor an outcome is required. Message `success` does not prove native admission. |

Use `Context` for native association and retain `InputId` as a logical runtime identity, without introducing another `Ref` entity or requiring an input table. Main validates the versioned native locator/identity fields before constructing adapter types. Submission metadata is private to Main, outside renderer-editable message parts; add only fields with a concrete consumer. Do not expose file locations, native document payloads, or admission bookkeeping as editable message data.

P1 adds neither `agent_session_input` nor `agent_session_input_attempt`. The [current dispatch path](../../../../src/main/ai/streamManager/context/AgentChatContextProvider.ts) already saves a user message before execution, with `status: 'success'`; preserve separate evidence of native admission. Durable owns persisted submission/queue state, while the host keeps the minimum association needed to query it. Another table would not close the native/Cherry commit gap or guarantee exactly-once execution. Do not run concurrent retries of one input. A missing receipt remains uncertain, and a later query failure must not erase confirmed admission.

The retained-branch edit design creates a new message instead of overwriting the submitted one. The [current message update API](../../../../src/main/data/services/AgentSessionMessageService.ts) still allows in-place edits, so integration must enforce submitted-version immutability and prevent active/recoverable submission evidence from being hard-deleted. Preserve that evidence or explicitly retire its recovery obligation before deletion. Durable same-key submission does not compare payloads: retry is permitted only with the original actual payload, target and policy. If those cannot be established, keep the result unresolved rather than rebuilding a request from edited parts.

Reconsider an independent input table only for a demonstrated owner: durable host inputs without message rows, submission tracking that must outlive deleted display messages, or one product message dispatched as several independent executions. These needs require their own retention and lifecycle design; they are not P1 prerequisites. Existing cross-session delivery remains with its current owner.

Product branch selection and observed child ownership are distinct relationships. P3 persists the native relationship under `(parentContextId, nativeSubagentId)`, with optional child context and provenance, when the child projection consumes it. This relationship can describe an inaccessible child; it is neither an assignment result nor authority to submit. P1 must allow several native associations per product conversation without introducing an unused task or generic spawn table.

For response association, persist a product response-message ID once projection has identified it, plus native evidence when available. Pi's typed `input-placed`/`input-settled` events supply entry IDs. Durable's persisted submission ID can be queried again to recover its answer evidence. Live `ItemRef` strings, epochs and subscription revisions are not permanent keys and must not be decoded by host code. P2 owns the mapping from several native content items to one product message; P1 does not impose one-input/one-answer or one-item/one-row cardinality.

Keep `AgentSessionDeliveryService`'s cross-session business delivery separate from native input admission. Its existing `delivery*` columns continue to serve that workflow. A delivery can link to an input when dispatched, but `accepted` delivery, native acknowledgement, and answered input are different facts. Do not repurpose those columns as the universal runtime journal.

##### Writes, errors and partial success

Use [DbService.withWriteTx](../../../../src/main/data/db/DbService.ts) only for synchronous database work. Data services compose `*Tx` writes; the lifecycle coordinator performs harness/file operations outside those transactions and retains their Promises after a window stops waiting. A data API endpoint must not hide native execution inside a database mutation.

1. Commit the context creation intent, or the user message with the private submission information required by its consumers, together with the captured product/native association. If this commit fails, do not call the harness. This uses the message's identity and retained content, not a second input-body record.
2. Invoke the native operation outside the transaction. Subscribe to the source before dispatch and buffer facts that arrive before the receipt supplies its native identity. Bind them only through native evidence, never through text or arrival order. Serialize host writes per context.
3. Commit native identity, receipts and observed facts when known. Preserve confirmed admission and terminal evidence when an older receipt arrives. A later `input.changed` event may settle the logical input without reconstructing individual invocation history.
4. When P2 writes a final display response, commit that display update, response association and known input terminal facts together before declaring product delivery complete. Multiple affected inputs can share that one response. Coalesce streaming updates to existing rows; do not insert a row per token.

The native commit and Cherry transaction are separate failure boundaries, even if both use SQLite. Do not implement a distributed transaction or promise exactly-once model/tool execution.

| Failure point | Persisted evidence | Required recovery |
| --- | --- | --- |
| User message and submission information committed, no receipt | The operation might not have started, or might have started without its receipt being saved. | Preserve uncertainty. Neither message `success` nor a pre-call dispatch marker distinguishes the crash window. |
| Native context created, association write failed | Creation intent and, when supported, a preselected native identity/locator. | Find and verify that context before binding it. If its identity cannot be recovered, retain the unresolved intent instead of automatically creating another context. |
| Native input accepted, receipt write failed | Retained user message and captured target/key; native submission or observed entry evidence may survive. | Retry the Cherry write while its owner is alive. On restart, reconcile native evidence; do not resend merely because the product receipt is missing. |
| Query fails after acknowledgement | The confirmed acknowledgement remains valid. | Record the read failure separately; do not downgrade admission to rejection or overwrite a known outcome. |
| Output committed natively, display/terminal write failed | Product input and possibly native answer evidence. | Reopen passively and repair projection only where mapping is proven. Missing attribution stays unresolved; it does not justify another generation. |
| Native store is missing, empty, unreadable or has another identity | Product history and existing association. | Preserve them and report unavailable native access. Do not reconstruct or create replacement context in `open`. |

Pi has no durable input deduplication. Never automatically retry an uncertain Pi invocation; a user-chosen new invocation gets a new message/input ID and acknowledges the duplicate-execution risk. For Durable, query the captured conversation using the explicitly supplied stable key or known native submission ID. Only a defined retry policy with the unchanged actual draft may resubmit under that key; query support does not create a host retry queue. Reject a changed payload under an existing key. A failed or missing lookup is not proof of non-admission.

##### Migration, restoration and retention

Append new production migrations; never rewrite shipped migrations. The SQL migration adds tables/nullable columns and preserves existing message IDs, data, search fields, statuses, delivery fields and resume tokens. It performs no filesystem or harness calls and does not backfill synthetic admission/outcome facts.

Keep three migration scopes separate:

| Scope | Data change | Cutover condition |
| --- | --- | --- |
| Native association and submission facts — P1 | Add backend/context records and only necessary Main-private submission metadata on existing messages. No input table or duplicate input body. Seed candidate identities, confirm only verified native bindings, and never synthesize admission facts. | Existing archives and APIs still work; native recovery has one selected execution writer. This does not wait for conversation-membership or physical-table consolidation. |
| Agent tree and branch actions — before P2 product cutover | Add parent/root semantics to Agent messages and product selection to their owner. Replace flat history/edit-tail readers and writers together; add sparse branch/native bindings. | Selected-path queries, retained-branch edits, attachments, projection routing and native fork pass their acceptance checks. Until then, keep the current flat path; do not flatten a new tree for an old writer. |
| Physical archive consolidation / explicit membership — separate design | Decide archive ownership and, if consolidating, migrate table references and consumers. Coordinate explicit user membership with #20635; no automatic sidebar entry for a background/child archive. | One archive writer/read model per migrated owner, preserved IDs or an explicit complete mapping, and validated navigation/retention semantics. No permanent dual-write of full messages. |

For the tree step, backfill each existing session as one virtual root followed by its current `(createdAt, id)` display order. Preserve every existing message ID, content and dependent reference; empty sessions receive only a root. Initialize selection to the last display node, not a fabricated completed execution head. The root is structural: exclude it from public content, search and model input. This chain records the legacy display order, not proof that queued or rejected input was consumed. Historical tails already deleted by old edit behavior cannot be recovered from these rows; do not invent branches or import native history by text matching.

Tree activation is a coordinated service/UI change. Add same-owner parent validation and cycle prevention; revalidate source/version within the publication transaction. New edited messages are siblings at the edited position. The Agent message adapter queries the selected path and exposes branch actions through the shared UI contract; its write API and Main-only delivery/checkpoint fields stay owned by Agent services. Pending and streaming rows retain their recorded state until native reconciliation. An observer writes to its captured binding and message identities, never whichever branch a window currently selects.

If physical consolidation is later selected, migrate the following explicitly:

| Dependency | Preservation rule |
| --- | --- |
| Message IDs, ancestry and private state | Preserve IDs where collision-free; otherwise persist a complete old-to-new mapping and rewrite references atomically. Preserve Main-only checkpoints and `delivery*` state under an explicit owner; do not expose them as editable message parts. |
| Attachments | Rebuild the relevant foreign keys and reference rows before retiring the old table; account for different supported roles in chat and Agent attachment relations. Cascading deletion must not orphan or prematurely remove files. |
| Usage and search | Usage `messageKind`/message ID are request-time attribution, not a reason to charge a copied prefix again. Readers must resolve existing ledger identities. Rebuild search indexes from the authoritative archive, excluding structural roots. |
| Navigation and membership | Migrate pins, saved routes/tabs, order, activity, trash and placeholder reuse coherently. Preserve agent/workspace, task-schedule and channel bindings; an `agentId` is not an `assistantId`. Membership must be explicit before generic topic navigation includes Agent archives. |
| Backup and cleanup | Capture mappings, product metadata and native associations together; make restore and purge understand the new owner before removing the old one. Shared native stores remain protected by all retained bindings. |

Database backfill uses the registered [AgentSessionContextSeeder](../../../../src/main/data/db/seeding/seeders/AgentSessionContextSeeder.ts), after the retired-runtime seeder. It runs with `run-on-change`, including on existing installations, and uses the supplied `db` in a synchronous transaction while `DbService` is still initializing. For known Pi sessions it collects distinct `runtimeResumeToken` and edited `data.nativeSessionId` candidates; pending DSH conversions contribute only their preselected new Pi identity, never their old DSH tokens. Other harnesses and orphaned histories with no known owner retain their archives without guessed Pi associations. Existing associations remain unchanged; new candidates have `intendedThreadId` set and `nativeThreadId` null.

The seed transaction performs only database work. It neither reads native files nor creates harnesses, selects a writer, changes message history, or fabricates submission facts. The seed journal means candidate registration completed, not that native histories are available. A failed transaction leaves no partial backfill; replay after a committed write but missing journal preserves existing identities.

The native context layer separately verifies the native header and location before `confirmPiContext` commits a confirmed association. Missing files and conflicting evidence remain unresolved and can be retried independently of the seed journal. Do not pick the latest assistant token blindly or manufacture one new native context per old message. Display content and text matching are never identity evidence. Production confirmation and registration of identities created by the continuing legacy path remain part of the P2 lifecycle cutover.

Keep each unmigrated context on its existing execution path. Cutover selects one writer before native dispatch; it cannot fall back to the old driver after an error or unknown result. For migrated contexts, replace the existing crash-orphan sweep's blanket failure/token clearing with native reconciliation. Existing v2 history with no verifiable native context remains readable; this is not a v1 migration fallback.

A pre-cutover failure can leave the current execution owner in place only if no new native dispatch occurred. Once a migrated owner has written branches or native inputs, disabling the new path cannot hand it to an incompatible old binary/writer. Stop admission and repair forward, or restore a coordinated backup; never “roll back” by flattening branches, clearing receipts, or repeating native work.

Restart in this order: **load backend/context records → verify native store and ownership → open and observe → reconcile inputs and product mapping → decide whether to schedule**. Pi reopening restores saved context, not interrupted execution or an unflushed queue. Durable reconciliation stays passive. Only afterward may an explicit host decision enable submit/interrupt/resume for the entire Harness, including its other conversations. No extra reporter or parent notification is synthesized.

Edit/fork retains its existing checkpoint/file transaction owner. Publish any resulting native association and product branch selection only after its native result is known; do not retarget an old input or overwrite an old context's identity. Historical display rows can be retained without pretending they were generated in a newly forked native context; any copied prefix needs the fork operation's explicit native mapping.

Window close, access release and product soft deletion do not delete native storage. Permanent deletion is coordinated by the storage owner only after active work and all retained associations have been checked; deleting one Durable conversation's product view cannot unlink a store shared by other conversations. Message retention includes its private submission evidence; any separately justified payload snapshot follows the same policy. Native data retains its own coordinated retention boundary.

Backup/restore must include the backend/context records and their associated native data in one coordinated capture. Extend the existing write-quiesce boundary to native writers, drain product projection writes, and use a supported native snapshot or cleanly closed store. Never copy only a live SQLite main file while ignoring its WAL, or assume `DbService.createSnapshot` includes native files. Restore into staging, validate identities/associations before promotion, and retain history without replacement creation when an older backup lacks native data. This is a production cutover requirement, not completed backup integration or a claim that every Pi queue can be paused and resumed.

##### P1 implementation and verification boundary

P1 covers backend/native associations, necessary message-owned submission metadata, focused database services, native store binding/strict loaders, and recovery fixtures using existing product owners. It adds neither an input table nor attempt history; physical table consolidation, per-message `contextId`, and session `rootContextId` are not prerequisites. It changes no mandatory common runtime method and does not switch desktop execution. Before P2 product cutover, land the Agent tree migration, retained-branch edit actions and typed native history path; P2 then adds product projection writes and lifecycle integration. P3 adds independently persisted child relationships/output; P4 verifies Durable scheduling and crash recovery in the application. File ownership, backup capture and deletion coverage must be ready before production cutover for the affected backend.

| Scenario to verify | Required observable result | Owner / acceptance |
| --- | --- | --- |
| Migrate a populated current-v2 database | Existing history, delivery state and search remain readable; new associations can remain null. | Database tests with `setupTestDatabase()` and production migrations; AC8. |
| Backfill empty and populated flat Agent archives, including pending delivery | Existing IDs, attachments, usage, private state and ordering survive; one root/selected path is valid; no admission facts or lost branches are invented. | Production-migration/database fixtures for the tree step; AC8. |
| Edit the first or a later input, then revisit and continue both branches | Old descendants survive, the new branch is selected, and each send resolves its own native head/checkpoint. Empty-prefix creation is explicit; a nonempty prefix without a checkpoint is rejected. Reopening or browsing does not execute work. | Pi/Durable native-fork fixtures and product action tests; AC9, AC12. |
| Switch windows/branches while an input acknowledgement or projection is delayed | Late writes retain their original target and cannot change another branch's content or selection. Fork/version conflict leaves the source intact. | Coordinator/projection integration tests; AC6, AC9. |
| Reopen a missing/mismatched native context or a swapped Durable store | Access is unavailable and no replacement file/context/identity marker is created. | Strict-loader/native-storage tests; AC1, AC8. |
| Native create/admit succeeds but the following Cherry commit fails | Recovery binds the evidenced context/input once, or explicitly preserves uncertainty. | Coordinator tests with real DB/native fixtures and injected boundary failures; AC8. |
| Retry identical input, or edit a draft under its old identity/key | Durable uses native deduplication where supported; changed drafts are rejected; uncertain Pi work is not silently resent. | Input data/admission tests; AC2, AC8. |
| Edit or delete a submitted message, or mutate its private metadata through public APIs | Submitted content/target/policy and unresolved recovery evidence survive; an edit creates a new identity. Display `success` is not promoted to native acknowledgement. | Message-service/admission integration tests; AC2, AC8. |
| Terminal evidence arrives before acknowledgement; two inputs share one response | Late receipt preserves terminal facts; both associations reference the same product response where known. | Message-submission/projection integration tests; AC7, AC9. |
| Passive Durable reopen and lookup | No model/tool work starts. Forced-process recovery is separately required in P4. | Real-Harness fixtures in P1, worker-process crash tests in P4; AC8, AC11. |

The P1 foundation now includes the additive backend/context migration, a private `submission` column on the existing message, immutable submitted content, explicit native creation, strict opening and passive reconciliation. [Native storage fixtures](../../../../src/main/ai/agentSession/__tests__/nativeContext.test.ts), [message submission tests](../../../../src/main/data/services/__tests__/AgentSessionSubmission.test.ts) and the [populated migration fixture](../../../../src/main/data/db/__tests__/agentNativeContextMigration.test.ts) exercise real adapters and SQLite. [Seeder tests](../../../../src/main/data/db/seeding/seeders/__tests__/AgentSessionContextSeeder.test.ts) cover the registered upgrade path, initialization timing, atomic rollback, replay, and pending DSH conversion identities. Native fixtures separately verify confirmation and retry after seed completion. A lost Durable conversation-creation binding remains an unresolved intent when its native identity cannot be recovered.

Strict opening uses small pinned dependency patches: `SessionManager.openExisting` validates a current-format header without initialization, and `SqliteStorage.openExisting` reads an already initialized schema without migrations. Node SQLite uses [`mode=rw`](https://www.sqlite.org/uri.html) so missing files cannot be created. Unsupported native format versions remain unavailable pending explicit migration. The Main observer retains failed fact writes for `flush()` and must remain owned until its caller stops it; these helpers do not register a second lifecycle service or switch desktop execution. The initial input path accepts retained text-only content and rejects other parts rather than storing a transformed-payload copy.

The Agent tree step now adds an append-only schema migration and a registered `AgentSessionMessageTreeSeeder`. It preserves message IDs, timestamps, attachments, usage and delivery metadata, then selects the migrated leaf without inventing submission facts. Pending completion deliveries capture the sending branch. Existing context rows carry `anchorMessageId`, `headMessageId` and opaque `checkpointMapping`; shared prefix rows keep their original native provenance.

The current desktop driver path uses the shared sibling navigator. Selecting a sibling chooses its latest descendant without opening a harness; a later send resolves that branch's native target. A send captures its parent before asynchronous validation, rejects an advanced parent, and never follows a later UI selection. Runtime output, queued turns and completion/error deliveries keep their captured branch. Renderer acknowledgement refreshes Main's selected path rather than inserting off-branch reservations into its cache.

[Tree fixtures](../../../../src/main/data/services/__tests__/agentSessionMessageTree.test.ts) verify replay-safe migration, selected-path pagination, branch isolation and delayed delivery. The [native publication fixture](../../../../src/main/ai/agentSession/fork/__tests__/branchPublication.sdkContract.test.ts) uses real Pi session files and SQLite to verify repeated edits and independent bindings without rewriting the common prefix. These fixtures do not establish provider execution or application crash recovery. A tracked development Electron instance additionally exercised later-input edit, sibling navigation, continuing both native histories, and first-input edit through the real UI/Main/Pi path using a local scripted HTTP model. Native requests contained only the selected branch's inputs. This is development integration evidence, not live-provider, packaged-build, Durable, or forced-process recovery acceptance.

The note remains proposed: independent child owner/projection wiring, Durable desktop integration, native backup/deletion integration and forced-process crash acceptance remain unfinished. Graceful native close/reopen and injected DB failures do not satisfy the application crash gate.

#### Pi root integration evidence

The root connection now owns a configured Pi Runtime and retained access. Native history and live
snapshots remain separate from the product archive. Main writes submission facts on existing user
rows, then commits final response associations with the assistant row. Native Pi providers call
Cherry's internal gateway, which owns upstream provider selection, credentials and billing;
Pi owns native history, streaming, tools and the execution loop.
The Pi facet keeps history, context usage, tool lookup and manual compaction outside the common API.
Queued inputs left unplaced after stop/error receive aborted evidence and are not automatically resent.

Real native-loop/SQLite fixtures cover create, strict reopen, streamed output, tools, steering,
interruption, missing/ambiguous files, attachments, disabled tools, compaction, and response-transaction
rollback. The gateway integration fixture uses a local HTTP provider, executes a native tool and verifies
one billing row per model call. These fixtures do not prove live-provider or forced-process recovery.
Reasoning replay and provider metadata follow Pi's native provider implementation and transcript;
Cherry does not encode a separate replay format. Existing attachment file paths remain in the
submitted text, without adding a duplicated payload column.

A tracked development Electron instance exercised the common Runtime path with a local scripted HTTP
model: fresh creation, graceful restart and reopen, retained-branch edit, browsing without model calls,
and independent continuation of both native histories. Live steering recorded queued, placed and final
response association in order. Stopping an unplaced native input recorded aborted; the next explicit
send did not replay it. Persisted partial output and per-call billing were checked in SQLite. These
checks cover Pi root integration, not independent child projection, packaged builds or crash recovery.

#### Delivery stages and verification gates

These stages describe the cumulative roadmap; the implementation evidence above identifies the gates already exercised. Production cutover waits for both P0 native evidence and P1 storage gates. Select one execution and persistence path per context before dispatch. Keep unmigrated contexts on their existing path; after native dispatch, an error or unknown receipt must not fall back to the other driver or start a second writer.

| Stage | Deliverable | Gate before moving on |
| --- | --- | --- |
| P0 — native evidence | Pi correlation/upstream improvement and typed terminal mapping; document many-input answer attribution. | Identical text, transformed/handled/failed commands, queued and undelivered input, abort, truncation, late acknowledgement, and child continuation preserve the correct identities/outcomes. AC2, AC7. |
| P1 — associations and submission facts | Native associations, necessary private submission metadata on messages, stable backend scope, strict loaders, and populated-database migration. | Read old history without inventing admission, detect missing native context, reconcile partial creation/admission, and reject changed drafts under an old identity/key. AC1, AC8. |
| P2 — Pi root integration | Agent tree migration, retained-branch edit actions, typed native history access, native provider binding to the internal gateway, root projection, and lifecycle mapping. | Exercise the desktop create/open/submit/observe/stop/reopen path and independent branch continuation; preserve permissions, configuration, usage, commands, and delivery completion. AC3, AC4, AC6, AC9, AC12. |
| P3 — independent Pi children | Current-view reduction, evidenced independent archives, owner restoration and child input without a live parent message; delivered in the slices below. | Parent completion/window closure does not lose committed child output; gaps and cold reopening reconcile without duplicate history; continuation reports once through the owner. AC3, AC5, AC6, AC8–AC10, AC12–AC16. |
| P4 — Durable host integration | Reuse host projection and message submission associations while retaining native submissions, task scheduling, reporting policy, and recovery. | Passive reopen performs no model/tool work; a forced process death and a new process using the same store reconcile unfinished work and input receipts. AC8, AC11, AC12. |
| Later — common controls | Optional spawn/stop and host-owned cross-harness delegation under the control note. | Prove creation/partial admission, stop scope, and continued-input semantics for both adapters before sharing signatures. Not a gate for P0–P4. |

Before P2 cutover, map each current `PiRuntimeConnection` responsibility to its replacement. Each native Pi model request must pass through the internal gateway and Cherry's provider execution without re-entering `AiService.streamText`'s agent-session branch or adding a second tool loop. The gateway is the sole billing owner; native usage serves context and display. Preserve approval and MCP behavior, frozen/live configuration rules, identity prompts, shell setup, tracing, commands/compaction, and native edit/fork checkpoints. Validate reasoning replay through the selected native protocol and state how unsupported content/attachments are represented before claiming parity.

Extend existing public-boundary tests in the [Pi runtime suite](../../../../packages/agent-runtime-pi/tests/runtime.test.ts), [Durable runtime suite](../../../../packages/agent-runtime-pi-durable/tests/runtime.test.ts), and [observation suite](../../../../packages/agent-runtime/tests/observation.test.ts). Host verification belongs with the existing runtime, archive-persistence, delivery, message-backend, and `useAgentSessionParts` tests; add focused projection and private-submission-metadata tests there as those paths are introduced. SQLite tests use `setupTestDatabase()` and production migrations. Durable crash tests use an isolated worker process and persistent store, kill after an evidenced checkpoint without `shutdown`, and verify recovery in a fresh process. External tool effects are not assumed exactly once.

For implementation changes, run explicit affected test files and inspect `docs:affected`; update current reference docs only when their code path changes. Package tests and graceful close/reopen do not satisfy the Electron or crash-recovery gates. The P1 layer also runs scoped host/native fixtures, affected consumer tests, Main typechecking and migration checks.

#### P3 implementation slices and acceptance

The table separates P3's implementation and verification boundaries; A/B/C ship together in one PR stacked on Pi desktop integration. The evidence below distinguishes core checks from desktop checks. Keep the common access interface unchanged unless an adapter-backed consumer demonstrates a missing contract. The [Claude Code migration Spec](2026-10-27-agent-runtime-claude-code.md) applies these consumption rules in a separate PR; Durable desktop adoption remains P4. Generic spawn/stop, cross-harness delegation, configuration reconciliation and physical consolidation with `topic`/`message` are not prerequisites for P3.

| Slice | Change boundary | Required evidence before cutover |
| --- | --- | --- |
| P3-A — host projection core | Reconcile observations per thread into the shared message model, reuse per-message SDK readers and coordinate snapshot replacement with live updates and attachment. Native dispatch and product storage remain outside this core. | Partial/replacement snapshots, replacement/removal, repeated frames, gap and isolated consumer failure satisfy AC3, AC13 and the transport portion of AC15. Exercise real Pi/Durable observations and `readUIMessageStream` as well as focused fixtures. |
| P3-B — child ownership and archive | Restore Pi's parent owner; add native entry correlation, independent child archive ownership, idempotent product writes and recovery/flush barriers. Add only the schema and typed Pi extension consumed by those paths. | Real Pi parent/child files and `setupTestDatabase()` prove AC8–AC10, AC14 and writer/close races in AC15. Child reopen must not become an unrelated writable root. |
| P3-C — Pi desktop cutover | Route discovered children to the shared Main owner, expose authorized history/live subscriptions and owner-routed input, and replace migrated child flow rendering with the shared message view. | Electron verifies AC5, AC6, AC12 and AC16, including parent completion, two windows, continued input, reconnect, cold reopen and projection errors. Root behavior, approvals and single billing remain intact. |

P3-A establishes the reducer, P3-B supplies the native-history/storage handoff, and P3-C switches the Pi child writer and view. The combined P3 PR keeps the Spec proposed and reports evidence for each boundary separately; a green reducer suite is not independent-child acceptance.

P3-A's [focused tests](../../../../src/main/ai/agentSession/__tests__/ThreadMessageProjection.test.ts) exercise real SDK accumulation, shortening/reordering, replacement/removal, input correlation, preliminary tool results, committed-baseline attachment, retired callbacks, projection/subscriber failure and `ThreadFeed` overflow recovery. The [integration tests](../../../../src/main/ai/agentSession/__tests__/ThreadMessageProjection.integration.test.ts) run real Pi/behavior and Durable loops with scripted native model providers. They cover two Pi background children surviving parent completion/access release, stopping one sibling, continuing the same child through reattachment, foreground child cancellation and a subsequent parent turn, plus a Durable parent/child/grandchild chain and child-only continuation. They do not cover independent child SQLite archives, IPC/windows, cold-start ownership restoration, forced crashes or real-provider acceptance. These checks support AC3, AC13 and the observation portion of AC15; the full P3 acceptance remains open.

P3-B/C now connect [ChildThreadProjection](../../../../src/main/ai/agentSession/ChildThreadProjection.ts) to Pi-owned child access, the existing session/message tables and owner-scoped IPC. [Projection tests](../../../../src/main/ai/agentSession/__tests__/ChildThreadProjection.test.ts) cover stable published snapshots from an initially empty assistant message, incremental text, late committed ordering, tool results before idle, and failed archive reads/writes followed by observation-only recovery. [Storage tests](../../../../src/main/data/services/__tests__/AgentChildArchive.test.ts) exercise a populated migrate-forward, child identity isolation, root admission rejection, trash/restore, FK deletion and native-file retention. [Desktop connection tests](../../../../src/main/ai/runtime/pi/PiRuntimeConnection.test.ts) prove same-child continuation and orderly owner reopening without additional model calls; [Renderer tests](../../../../src/renderer/hooks/agent/__tests__/useAgentChildProjection.test.ts) cover snapshot/live overlap, duplicate and missing revisions, bounded attachment buffering and retired subscriptions.

The 2026-10-26 isolated Electron acceptance used the configured Claude Sonnet 4.5 provider through the production gateway. It covered foreground output, two background siblings after parent completion, child-only continuation, two-window observation, closing one window during active child work, and cold-start history display. The empty-message regression originally suppressed intermediate desktop delivery; separating the SDK's mutable seed from the published view restored streaming. The repeated 12-line case delivered 74 updates, including 70 text-append patches, with visible partial output before completion. These are functional observations, not a comparison with the old flow. Forced-crash recovery, relocated-backup ownership and the one/ten-child performance matrix remain unverified; the full P3 acceptance stays open.

##### Minimal child archive and migration

Reuse `agent_session_message` and its existing service for product content. The initial child archive uses a separate `agent_session` container and tree root, with the existing `background` classification solely to keep it out of ordinary conversation navigation; no new `subagent` session type is introduced. This is a product storage owner, not creation of another native root, schedule or cross-session delivery. Resolve runtime access through the child's saved native relationship before any generic session-open/input path. Do not copy the parent's message prefix or merge the child's nodes into its normal selected path.

Persist only facts consumed by reopening and display: the existing parent-scoped relationship key `(parentContextId, nativeSubagentId)`, optional verified child context and archive association, and evidenced source-to-product mappings/discontinuities. Tool-call provenance can be absent; it does not authorize controls. An inaccessible relationship does not require a fake native context or a writable archive. Continue to use message-owned submission metadata for actual child input; no input/attempt table, native transcript mirror, or universal run table is added.

The archive container inherits product access from its owning relationship, not from a caller supplying its ID or from `type: background`. Queries, generic controls, search/navigation and background GC must distinguish this ownership from scheduled-job sessions. Parent branch selection must not redirect its writes; copying a branch must not copy control authority over an existing child. Deletion, backup and retention must protect the relationship, archive and native owner together. A relationship/GC consumer audit is a P3-B production gate, not an assumption that the existing background classification already provides these guarantees.

Use an appended schema migration and database-only Seeder where backfill is required. Existing embedded child parts stay readable. Promote only native identities and mappings that can be verified; tool-result text, matching content and a tool-call ID alone are insufficient. Unverified legacy content remains historical display without newly granted input access. The native loader verifies candidates outside the seed transaction; migration never creates or runs a harness.

Select and persist one projection route per migrated child before starting its writer. A parent may contain legacy historical content while newly observed children use the new route, but the same child cannot be written through both paths. Once published, the tool card reads its linked archive; embedded legacy content remains a historical snapshot rather than a second live feed. Failure or uncertain recovery after cutover seals that route for repair; it does not reactivate the old flow writer or resubmit input. Remove the Pi child flow path when its migrated consumers are covered; retain CC's existing path until its separate migration.

##### Focused P3 verification matrix

| Scenario | Required observable result | Verification owner |
| --- | --- | --- |
| Attach while a message/tool argument is partial; shorten or replace it; repeat a Durable snapshot | The shared message model reflects the accumulated value, continues streaming and ends only on actual evidence; no repeated archive import or stale reader overwrite. | Projection with real `readUIMessageStream` and Pi/Durable adapter observations; AC13. |
| More than 100 frames in one synchronous burst, followed by compaction or preview replacement | An explicit gap occurs; the view converges and native committed entries reconcile once. Unrecoverable content remains a visible discontinuity, not invented history. | `ThreadFeed`, Pi history bridge and real DB fixtures; AC14. |
| Reader/reducer or DB write fails while the child continues | Other threads continue; no repeated enqueue/log storm, no false persisted completion and no repeated model/tool call. Repair reuses the native owner and identities. | Host failure injection with real DB; AC14, AC15. |
| Replace observation with a delayed sink/write; deliver replay and live updates across attachment | Old accepted writes retain their target; no retired callback overwrites the new view, and each source update appears once. Legitimate repeated text remains. | Coordinator/transport race fixtures; AC9, AC15. |
| Parent ends, its accumulator is removed, or one of two windows closes | Child output continues through one Main observer/writer; the remaining window and saved archive agree. | Electron plus projection ownership assertions; AC5, AC6. |
| Cold reopen and continue the same child after parent completion | Restore parent ownership and product IDs; retain history and report the new result once through the native owner. Missing owner allows historical reads but no writable-root fallback. | Real Pi files/DB and Electron; AC10, AC12. |
| Upgrade legacy parent-embedded content, switch branches, then delete or back up the owner | Proven associations migrate once; unverified content stays readable; active/retained child archives and native data are not swept as disposable jobs. | Production migrations/Seeder and lifecycle fixtures; AC8, AC9. |
| Shut down during partial output or terminal persistence | Native tail evidence is handed off before access disappears; accepted product writes finish or remain explicitly unresolved. Graceful reopen is distinguished from forced-process loss. | Native/store shutdown fixtures and Electron; AC6, AC14, AC15. |
| Run one and ten children with long output while sibling views stay idle | Normal updates contain only changed child items/parts, do not rewrite parent parts or refetch the full archive, and do not rerender unchanged siblings. Record IPC bytes, write batches and render counts against the old flow under the same fixture. | Electron performance scenario; AC16. |

## Alternatives considered

- Make `submit` return the only output stream: rejected because queued input, unsolicited native work, reconnects, and child streams do not share that lifetime.
- Add a second `Backend` abstraction or a string matrix for every native effect: rejected because the configured `AgentRuntime` already owns access, and consumers still need concrete native semantics.
- Put creation, tools, history editing, fork, resume, and delegation controls into the mandatory interface: rejected because current native capabilities and ownership differ. Keep typed adapter extensions until common use is established.
- Expose internal epochs, revisions, attempts, or raw SDK payloads: rejected because source mapping belongs to adapters and delivery/projection coordination belongs to the host; these fields would not create durable guarantees.
- Retry unknown input, dispose on last release, or simulate atomic idle admission with a local flag: rejected because each can lose evidence or race work the adapter does not own.
- Put Durable tables behind `DbService` or implement a universal host `Storage`: rejected for P1 because native asynchronous commit/recovery and Cherry synchronous business transactions have different owners; use the existing native backend in its own file.
- Use display messages as native history or retain only the latest resume token: rejected because native branch state, queues, partial creation, and exact native payloads cannot be recovered from that projection.
- Introduce a second context tree for edits/branches, or encode spawn through ordinary message ancestry: rejected because the existing product message tree owns branch navigation, while child execution has independent ownership and input routing.
- Require independent input/attempt tables or per-message `contextId` in P1: rejected for this slice. Logical identity does not require its own table. Reuse the submitted message and minimum private submission metadata, and evaluate session/branch-anchor bindings; independent input retention needs a demonstrated consumer.
- Keep child content and its stream lifetime inside the parent message, adding only throttling or a subscription wrapper: rejected for P3 because ownership, recovery and full-parent publication remain coupled. Reusing an SDK reader per child message remains part of the chosen design.
- Create a separate child message schema or replace the SDK parser solely because it emits snapshots: rejected because the existing product model and incremental parser are reusable; snapshot output does not dictate transport granularity, and parser replacement lacks measured justification.
- Keep two desktop observation protocols indefinitely, or only rename the child routes: the former has the smallest immediate diff but duplicates attachment, gap and terminal handling; the latter retains that duplication. Share delivery with both real producers without merging their execution owners.
- Treat a larger observation buffer or a non-awaiting sink as a durable log: rejected because synchronous bursts and native compaction can still remove intermediate facts; archive reconciliation needs native identity and coverage evidence.
- Put child rows in the parent's ordinary message path or create a new native root for each child archive: rejected because both change ownership and continuation semantics. Reuse a separate product archive without granting it an independent execution owner.

## Acceptance criteria

The [evidence note](../testing/2026-10-17-agent-harness-evidence.md) distinguishes current adapter validation, historical probes, and acceptance not yet run. Package validation does not establish complete host integration.

- AC1 — Repeated and concurrent opens share native ownership, validate identity, and never replace missing context by creating a new one. (verification: unit — Pi and Pi Durable runtime tests)
- AC2 — Input receipts preserve native admission evidence across busy policies, hooks, unknown results, late acknowledgement, deduplication, and release races. (verification: unit — adapter admission and host delivery tests)
- AC3 — Multiple observers see consistent source identity and snapshot-first ordered delivery; overflow, mapping loss, sink failure, and stop are explicit and isolated. (verification: unit — ThreadFeed and adapter projection tests)
- AC4 — Releasing one access does not stop another access or native work; shutdown closes the whole owned instance without claiming history deletion or unsupported execution recovery. (verification: unit — adapter lifecycle and persistent-store reopening tests)
- AC5 — Child observation survives the parent message, managed-child controls preserve native ownership, and native result delivery is not duplicated by observation. (verification: unit — adapter child tests and host projection integration)
- AC6 — Desktop callers preserve logical input receipts and archives, fence replaced observations, flush outstanding writes, and present native interruption/scheduling scope accurately. (verification: Electron — product-session runtime integration)
- AC7 — Identical or transformed inputs, batched steering, local command failure, undelivered input, truncation, and late receipts retain evidence-based attribution without text matching or false successful completion. (verification: unit — native Pi correlation probes and adapter/host input tests)
- AC8 — Populated-database migration preserves history, IDs and dependent records; tree backfill preserves legacy display order without inventing admission facts. Submitted message identity/content and private submission evidence survive edits, protected deletion and partial native/DB success; recovery neither replaces missing context nor blindly retries uncertain input. (verification: unit — context/message-submission data tests with production migrations and native storage fixtures)
- AC9 — Child content persists independently of a parent assistant row; snapshot replacement and stale-observer writes cannot delete archives, duplicate recovered history, or overwrite a newer view. Branch selection does not retarget captured inputs or projections. (verification: unit — host thread projection and archive-persistence integration tests)
- AC10 — A fresh Pi runtime restores a child's parent owner and relationship before continued input, preserves native stop/reporting policy, and never upgrades an unowned historical child into a writable root. (verification: unit — persistent Pi parent/child reopening tests)
- AC11 — A forced process death followed by fresh-process Durable reopening preserves input identity and native ownership; passive reconciliation starts no model/tool work, and permitted resume respects Harness scope without an extra host report. (verification: unit — Durable worker-process crash integration tests)
- AC12 — Root and child desktop flows preserve product authorization, model/tool boundaries, single usage accounting, delivery finalization, and documented stop/recovery behavior. Editing retains the old branch and selects the new one; browsing executes no native work, and continuing either branch resolves the correct checkpoint/binding. (verification: Electron — Pi and Durable host integration scenarios)
- AC13 — Root and child content use the shared product message model. Initial/repeated snapshots, subsequent live chunks, replacement/removal and changed tool arguments converge without duplicate history, lost partial updates or stale reader overwrites. (verification: unit — host projection with real SDK readers and Pi/Durable observation fixtures)
- AC14 — Overflow, compaction, reopening and shutdown recover mapped native committed content once; unavailable mappings remain visible discontinuities, and archive failure never becomes successful product finalization or repeated execution. (verification: unit — Pi native-history, real DB and shutdown integration fixtures)
- AC15 — Observation replacement drains accepted writes before handover; late callbacks cannot overwrite a newer view, attachment replay/live overlap applies each update once, and consumer failure stays isolated with bounded diagnostics. (verification: unit — host writer, transport and failure-injection fixtures)
- AC16 — Independent child rendering preserves streamed content with one Main writer across parent completion and multiple windows; ordinary updates touch only changed child items/parts, without full-parent publication, full-history refetch or unchanged-sibling renders. Comparable one/ten-child runs record IPC, persistence and render costs. (verification: Electron — child projection and performance scenarios)
- AC17 — Root and child share the desktop snapshot/patch subscription contract. Early updates, terminal attachment, duplicates, missing revisions, bounded-buffer overflow and publisher replacement converge to the scoped Main view without losing saved history or accepting retired callbacks. (verification: unit — shared publication/subscription fixtures with both owners)
- AC18 — Chat, Agent root/child, Quick Assistant and Selection consume shared projections without duplicate Renderer chunk readers; parallel models, continuation, approval, commands and terminal-to-DB handoff retain their behavior. Closing a view neither stops background work nor grants child control. (verification: Electron — shared desktop observation follow-up)

## Risks

AC17–AC18 belong to the proposed desktop observation follow-up, not completed P3-A/B/C evidence. Root migration must account for additional SDK transport consumers and reused execution IDs; shared child patch types alone do not establish parity. This delivery change does not resolve native history gaps or the same-child ordering issue below.

Post-rebase validation observed one intermittent existing-message order failure during same-child continuation. Subsequent focused runs and stream-delay probes passed without a production fix; the cause remains unresolved and blocks P3 acceptance. Keep the PR Draft and retain the failed-run evidence.

P3 cannot claim lossless token history from current-view observation. Pi now supplies live-to-native mapping, a final readable archive boundary and child-owner restoration; incomplete native retention still limits repair after a gap. The child archive inherits root ownership for admission, trash/restore, FK deletion and native-file retention, rather than scheduled-job policy. Relocated backups whose native parent path no longer matches remain read-only until ownership can be proved. Forced crashes and comparable one/ten-child performance measurements remain open; the implementation does not establish a performance gain.

Exact assignment cancellation and host cross-harness orchestration remain proposals. Optional child/input fields make restricted access representable, but do not establish an adapter for every harness or grant controls from restored history. Pi child continuation requires the owner's loader and retains native reporting policy. Retaining contexts until shutdown increases memory use; uncancellable preflight can delay shutdown indefinitely. Normalized views omit native data and can lose intermediate events under backpressure. Durable's in-memory logical-input mappings alone do not persist their association with Cherry messages. Treating any of these limitations as already solved by a shared type would make the abstraction stronger on paper than its implementations.

Separate native stores add coordinated backup/deletion work and duplicate some display text. Reusing messages requires submitted-version immutability and Main-only submission metadata; deleting recovery evidence or retrying edited content would invalidate the association. Any later payload snapshot needs its own justified consumer and retention coverage. P1 fixtures cover strict existing-store opening, Durable store identity markers and populated-database migration under Node. Electron support for the selected native SQLite driver remains a production gate.

Converging the flat Agent-session archive with `topic`/`message` requires explicit migration, branch-selection, native-binding, and child-history rules. Reusing the tree does not establish that its deletion, history-building, or routing behavior is already suitable for native agent execution.
