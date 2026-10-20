# Agent Note: Runtime access, input, observation, and lifecycle contracts

Status: proposed

English | [中文](2026-10-17-agent-runtime-contract.zh.md)

## Problem

Cherry needs to open native contexts, submit input, observe work independently of a particular submission, and release resources across different harnesses. Requiring every harness to adopt Cherry's session engine would duplicate native scheduling and recovery. A large capability matrix would instead make every consumer interpret those differences itself.

This note replaces the stack's runtime ownership and behavior design. It records the implemented v0 access boundary and its reasons, together with the host obligations still needed for integration. [Common types](../../../../packages/agent-runtime/src/contracts.ts), the [Pi adapter](../../../../packages/agent-runtime-pi/src/runtime.ts), and the [Pi Durable adapter](../../../../packages/agent-runtime-pi-durable/src/runtime.ts) own exact signatures. Package code exists; desktop adoption and the full acceptance below remain incomplete. The [harness boundaries](2026-10-17-agent-harness-boundaries.md) own the broader division of responsibilities.

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

Return rejection only when non-admission is known. Unknown results must remain unknown; later query failure cannot undo confirmed admission. The host persists the logical input and transport attempt before submitting, retains its Promise after a window stops waiting, and records late receipts. `input.changed` can confirm a logical input without proving which uncertain transport attempt succeeded. The runtime does not supply a durable host delivery journal.

The same `InputId` keeps immutable text and busy policy. New content is a new logical input. Pi has no persistent native input deduplication, so an unknown result must not trigger automatic retry. Durable's native deduplication key and lookup permit a different delivery policy; the host stores their relationship to `InputId` and replays the original draft. Native same-type deduplication does not validate payload equality. A missing lookup is not proof that no side effect occurred. Retraction distinguishes `withdrawn`, `already-placed`, and `already-settled`; retracting one input is not conversation interruption.

### Expose identities needed by consumers

| Public identity | Purpose |
| --- | --- |
| `Thread { backendId, id }` | Locate native context in a configured backend; persistence is conditional on native storage. |
| `InputId` | Host logical input identity, unique at least within its target context, independent of transport attempts. |
| `ItemRef { session, id }` | Identify updateable content and tool relationships. |
| `SubagentId` | Identify a relationship within its parent thread across child inputs and runs. It does not establish an assignment identity or require an accessible child context. |
| `NativeInputRef { session, id }` | Address a real native input for lookup or retraction when supported. |

IDs use distinct branded string types. Consumers can serialize them but must not interchange them, parse prefixes, or infer lifetime from formatting. The host supplies `InputId`; adapters return native/context/content references. Validate storage and transport data before restoring branded IDs. The host assigns a stable `backendId` namespace and ensures a single writer for it; v0 adds no interprocess lock.

`SourceRef`, epoch, revision, and sequence stay internal to source mapping and ordering. Transport `attemptId`, cross-process projection revisions, and subscription replacement markers belong to the host. There is no universal call context or cancellation signal that conflates stopping local waiting, interrupting native work, and ending observation.

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

The inspected desktop path still runs `AgentChatContextProvider → AgentSessionRuntimeService → PiRuntimeDriver → PiRuntimeConnection → pi.createAgentSession`. The three packages and the AI SDK model binding exist, but production desktop calls do not yet use their runtime factories. Existing background output finds a parent assistant row through `rootToolCallId`; output without that anchor is ignored, and child parts are persisted back into the parent row. Replacing the factory alone would preserve this ownership problem.

| Location | Planned change | Responsibility retained there |
| --- | --- | --- |
| [Common contract](../../../../packages/agent-runtime/src/contracts.ts) | Use existing thread, optional input, relationship, and observation contracts first. Add a field only after native evidence and a consumer require it. | No product rows, delivery journal, scheduler, or UI lane. |
| [Pi runtime](../../../../packages/agent-runtime-pi/src/runtime.ts), [projection](../../../../packages/agent-runtime-pi/src/runtimeProjection.ts), and [subagent owner](../../../../packages/agent-runtime-pi/src/subagent.ts) | Add verifiable input correlation and restore child access through its native owner. | Native sessions, child execution, result delivery, and typed Pi extensions. |
| [Durable runtime](../../../../packages/agent-runtime-pi-durable/src/runtime.ts) | Reconcile persisted input mappings and child ownership against native submissions/tasks before scheduler activation. | Native Harness/storage ownership and recovery semantics. |
| [Desktop Pi integration](../../../../src/main/ai/runtime/pi/README.md) | Reuse host configuration/materialization and assemble the production AI SDK model port; replace execution and output routing incrementally. | Prompt, skills, MCP, approvals, shell environment, model policy, usage, and tracing. |
| [AgentSessionRuntimeService](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts) and its persistence modules | Own configured runtime instances, logical input delivery, and a projection per thread. Extract an instance helper such as `threadProjection.ts` inside the existing module. | Product lifecycle, authorization, persistence barriers, and integration with delivery/fork operations. |
| [Data schemas](../../../../src/main/data/db/schemas/agentSession.ts) and [data services](../../../../src/main/data/services/README.md) | Add context associations and input delivery records using `DbService`, with appended migrations. | Product data transactions; no native execution or transcript parsing. |
| [useAgentSessionParts](../../../../src/renderer/hooks/useAgentSessionParts.ts) and shared IPC contracts | Address a context's projection independently of the parent assistant message. | Presentation and subscription; Main remains the persistence owner. |

The helper is owned by the existing lifecycle service, not a new singleton or a second execution engine. Native paths are resolved through `application.getPath`; cross-process schemas belong in `src/shared`. Persisted business reads use DataApi; submit, observe, interrupt, and recovery commands use IpcApi. Renderer input is authorized against the associated product session, not trusted merely because it contains a native ID.

#### Boundary 1: keep child lifecycle with its native owner

Discovery records a parent relationship; opening the child acquires access to its context. Neither operation creates an assignment or reports a result. Pi model tools and host child input must reach the same extension controller. Durable child access must retain the native conversation/task relationship; creating an unrelated conversation and submitting text does not implement a native subagent.

For Pi cold reopening, first restore the parent's saved subagent registry and delivery state, then resolve the child through that owner and its loader. Publish restored relationships even when no new `onSessionCreated` callback occurs. Loading a child file as an ordinary root would bypass continuation, stop, and reporting rules. If the owner cannot be restored, retain the historical relationship and fail the child open; the current concrete Pi handle promises input and cannot be treated as observation-only. Product history remains readable. Extend the Pi adapter's restoration path before making the desktop depend on it.

Keep result reporting in the Pi extension or Durable's native reporter mechanism. The projector never sends a completion back to the parent. Direct Durable child input does not create a reporter. Pi's suppression of automatic parent wake after a user stop is a Cherry policy to preserve when adding Durable reporting, not behavior guaranteed by the upstream example.

The later spawn/stop layer will expose owner methods shared by tools and host calls. It must distinguish child creation from initial input admission and retain a created child's identity when admission fails or is unknown. Stop must specify whether it affects the parent, the child's current work, or background descendants, and whether continuation remains allowed. Those decisions do not require a mandatory public spawn/stop interface in this integration.

#### Boundary 2: connect continued input to native evidence

Every new user message gets a fresh `InputId` and an immutable `InputDraft`, addressed to the existing child or root thread. Retrying delivery of that draft retains the same identity. Persist the draft and an attempt before dispatch; collect the result in Main even if the window or caller stops waiting. Admission, placement, answer attribution, and terminal outcome remain separate evidence.

| Evidence needed by Cherry | Pi implementation gate | Durable implementation gate |
| --- | --- | --- |
| Admission | Preserve preflight and owner-controller receipts, including locally handled commands and late acknowledgement. | Persist the logical input, deduplication key, and native Submission identity. |
| Placement and output attribution | Carry input correlation through hooks, native queues, history insertion, and child continuation. Do not match by text or queue position. | Reconcile native submission placement and run input sets; several inputs may contribute to one answer. |
| Terminal product state | Associate native completion, error, abort, or truncation with the affected input set. A settled session or complete assistant item alone is insufficient. | Map native done/unanswered/abort evidence without treating admission or foreground idle as successful completion. |
| Recovery of an uncertain attempt | No automatic retry without durable deduplication; preserve uncertainty when correlation was lost. | Use lookup and the original immutable draft under native deduplication rules; lookup failure cannot revoke known admission. |

Unpatched Pi 1.3.0's `PromptOptions` has no caller correlation token, and its steering/follow-up bookkeeping uses text. The first P0 slice now adds native caller correlation through transformed input, queues, history placement, and owner-managed child continuation. Cherry carries that change in a pinned dependency patch while the linked Pi checkout holds the source and regression tests; it is not an upstream release. The [evidence note](../testing/2026-10-17-agent-harness-evidence.md#p0-input-correlation-check--2026-10-19) records its validation and limits. The token does not alter transcript content, provide deduplication, or survive reopening by itself.

P0 now has package-level terminal and many-input attribution evidence. The Pi patch snapshots unanswered placed inputs at native request preparation and emits `input_settled` with the actual response entry after a final reply or terminal settlement. Tool/boundary continuations and retries retain the batch; queued or later-placed inputs cannot inherit an earlier response. The typed Pi `input-settled` event preserves native entry ID, input IDs, stop reason, and abort evidence. This is native response attribution, not proof of semantic task success or literal input consumption after arbitrary context hooks. The desktop path still waits for P1–P4 integration gates.

The common addition is optional `InputState.response: ItemRef`: several inputs can share the same terminal response without inventing an execution ID or assigning one `MessageItem.inputId` to an assistant answer. Pi supplies native batch evidence; Durable supplies each submission's answer entry. The reference follows current-view identity/coverage rules and is not a universal persistent history key. Normal final replies yield `completed`, errors `failed`, interruption `aborted`, and truncation or no final answer `unanswered`. Durable's native `done` also covers truncated/tool-only answers, so its adapter reads the actual answer before declaring success. Missing evidence keeps outcome absent. A handled command can fail without an assistant answer; late receipts must preserve established terminal facts. Finalize product delivery only after its corresponding projection and terminal evidence have been persisted.

`whenBusy` remains input admission policy. Non-waking notification, answering an interaction, and changing model/configuration are separate owner operations; none is encoded as another spelling of `steer`. This plan adds no universal interaction/tool interface.

#### Boundary 3: project each thread independently in Main

Use one host projection owner per `(backendId, threadId)` within its configured runtime. It owns the adapter handle, observation, current view, source-to-product item mapping, and pending persistence. Renderer windows subscribe to that view; opening a second window does not create a competing native projection or persistence writer.

```text
Parent Thread observation -> parent projection -> parent display
          Subagent link ----------------------> child display link
Child Thread observation  -> child projection  -> child panel / tool card
                            |
                            +-> child context's product messages
```

The child's content belongs to its context, with its own product message identities. A parent tool card holds the relationship and a presentation link, not the child's only durable storage location. Parent turn completion, removal of its live assistant accumulator, and closing its view must not stop child observation. A UI lane, if needed, is a Cherry view grouping derived from this association; it is not a harness execution identity.

Attach with a replacement marker already captured by the sink, since the initial snapshot can arrive before `observe` resolves. Serialize projection writes per thread. Before replacing an observation, fence the old writer, stop it, and drain its already-entered writes; only the current marker may commit subsequent work. Send the Renderer a host revision with a full view on attachment or a missed update. That revision stays outside the common runtime contract.

Within a valid mapping, accumulated upserts update the same product message instead of appending token rows. `snapshot`, `item.remove`, and `gap` change the current view, not stored conversation history. After compaction, rebinding, or reconstruction, reuse history identities only with native evidence. Do not append a recovered snapshot as new historical messages or deduplicate it by matching text. When mapping is unavailable, preserve the archive, mark the view discontinuity, and display the new current view separately; a complete native-history import is outside this slice.

| Product action | Host behavior |
| --- | --- |
| Window closes or changes selection | Detach that subscriber; retain the Main observation needed for active work and persistence. |
| Parent finishes, child continues | Keep the child's projection and native owner reachable independently of the parent message. |
| User stops generation | Seal relevant host delivery, request the documented native interrupt, and track its result; do not substitute `release` or claim all queues are empty. |
| Last view releases | Release unneeded access without assuming native eviction. Current adapters retain loaded contexts until shutdown. |
| App exits or an execution environment is retired | Seal admission, collect in-flight receipts, shut down the owned runtime, then drain/fence final projection writes before closing the database. Unknown cleanup remains visible. |

For the first Pi integration, scope the runtime to a product session's native root and owned child tree; keep all its handles behind that owner. Durable scope follows its exclusive native storage/Harness, which may contain several conversations. Do not apply the legacy per-message or per-connection idle TTL to a single conversation inside either owner. The initial policy retains the configured owner until explicit retirement or app shutdown; memory growth is a known limit. Per-thread eviction needs later native support and separate validation.

#### Boundary 4: persist product associations, recover native state

Use Cherry SQLite for product associations and delivery facts, and native storage for resumable model context, queues, tasks, and reporter state. The minimum host records below are proposed data shapes, not new public runtime types. Use `Context` and `Input` names rather than introducing another `Ref` entity.

| Record | Minimum stored facts | Constraint |
| --- | --- | --- |
| `AgentSessionContext` | Product context ID, product session ID, `backendId`, and native thread identity/validated storage locator once confirmed. | One product session can have several contexts; deduplicate confirmed associations by product session and native thread address. An unbound creation intent is not an openable Thread. Keep root selection separate from child ownership. |
| Observed subagent relationship | Parent context, native relationship ID, optional child context, and observation provenance. | Key by parent plus relationship ID; an inaccessible child remains representable. This is discovery data, not control authority or an assignment outcome. |
| `AgentSessionInput` | `inputId`, target context, immutable text/policy, product user-message association, known admission facts, optional native input identity, and evidenced outcome. | Changing text, policy, or target requires a new logical input. Missing outcome is not success. |
| Input delivery attempt | Attempt identity, logical input, dispatch intent, returned receipt/error, and whether the result remains unknown. | Record each native call; a timeout or process death does not prove rejection. Keep attempts host-private. |
| Product message association | Message ID, context ID, and input/native item correlation only where supported by evidence. | Child messages are separate rows; one answer is not required to belong to exactly one input. Adapter live item IDs are not permanent history keys. |

Implement the new records through Drizzle schemas under `src/main/data/db/schemas/` and a focused data service under `src/main/data/services/`; the existing runtime service coordinates them. Reuse `agent_session_message` for display records with explicit context association. Keep old v2 rows readable while their native association is validated; an unmatched row remains historical data, not a newly created native context. Do not copy native JSONL or Durable commits into these tables or put every stream delta into SQLite.

`backendId` identifies a stable configured storage/execution namespace, not a process or runtime object. For Pi, resolve a native session ID within Cherry-owned storage and verify the loaded header; a private relative locator can avoid scanning but is not identity. For Durable, bind the backend to one persistent store and resolve native Conversation IDs inside it. Store credentials in their existing owner, not these records. Paths and adapter configuration remain private to Main.

The write sequence has three separate boundaries:

1. Use synchronous `DbService.withWriteTx` to commit the immutable input, its product association, and dispatch intent. Never await a harness or file operation inside the transaction.
2. Invoke native create/open/submit outside SQLite. Hold the in-flight operation in Main, independently of Renderer lifetime.
3. Commit the known native identity/receipt and subsequent observed facts. For native creation, record intent first and use a recoverable native locator/correlation when supported. If creation succeeded but the association commit failed, reconcile that known context before retrying. If native identity cannot be recovered, retain an unresolved intent instead of creating a duplicate automatically.

DB and native storage do not form one transaction. Recovery also covers a committed intent whose call never started and a call whose receipt was lost; where they are indistinguishable, preserve uncertainty. Only retire/delete native storage through its owning lifecycle and explicit product operation. Backup/restore must keep the database and associated native stores consistent under the existing write-quiesce boundary; retiring a view does not delete files.

Restart follows **load associations → validate native storage and ownership → open and observe → reconcile inputs and projection → decide whether to schedule**. Pi can restore context and owner records, not resume an interrupted call or unsaved queue. Durable open/observe/lookup remains passive; the host permits scheduler-enabling submit/interrupt/resume only after reconciliation and at the whole-Harness scope. An uncertain Pi input remains unresolved rather than silently replayed. A retained Durable input is reconciled by native identity/deduplication key, without manufacturing another reporter or parent notification.

Replace the old crash-orphan policy for migrated contexts: it must not clear every resume token or mark recoverable Durable work failed before native reconciliation. Missing, empty, mismatched, or unreadable native storage preserves the product history and reports unavailable access; `open` never creates a replacement. Existing edit/fork operations must publish their new native association with their checkpoint/file transaction flow. They cannot use the most recent assistant token as the sole source of context identity.

#### Delivery stages and verification gates

These are implementation units, not claims of completed work or newly created PRs. P0 and the P1 schema design can proceed independently; production cutover waits for both gates. Select one execution and persistence path per context before dispatch. Keep unmigrated contexts on their existing path; after native dispatch, an error or unknown receipt must not fall back to the other driver or start a second writer.

| Stage | Deliverable | Gate before moving on |
| --- | --- | --- |
| P0 — native evidence | Pi correlation/upstream improvement and typed terminal mapping; document many-input answer attribution. | Identical text, transformed/handled/failed commands, queued and undelivered input, abort, truncation, late acknowledgement, and child continuation preserve the correct identities/outcomes. AC2, AC7. |
| P1 — associations and journal | Context/input/attempt persistence, stable backend scope, strict loaders, and populated-database migration. | Read old product history, detect missing native context, reconcile partial creation/admission, and reject changed drafts on retry. AC1, AC8. |
| P2 — Pi root integration | Production model port, root thread projection, product persistence, and lifecycle mapping. | Exercise the desktop create/open/submit/observe/stop/reopen path; preserve permissions, configuration, usage, commands, edit/fork, and delivery completion. AC3, AC4, AC6, AC9, AC12. |
| P3 — independent Pi children | Owner restoration, child projection, and child input without a live parent message. | Parent completion/window closure does not lose child output; cold reopening retains ownership; continuation reports once through the owner. AC5, AC9, AC10. |
| P4 — Durable host integration | Reuse host projection/journal while retaining native task scheduling, reporting policy, and recovery. | Passive reopen performs no model/tool work; a forced process death and a new process using the same store reconcile unfinished work and input receipts. AC8, AC11, AC12. |
| Later — common controls | Optional spawn/stop and host-owned cross-harness delegation under the control note. | Prove creation/partial admission, stop scope, and continued-input semantics for both adapters before sharing signatures. Not a gate for P0–P4. |

Before P2 cutover, map each current `PiRuntimeConnection` responsibility to its replacement. The AI SDK port must execute a single model request through Cherry's provider path without re-entering `AiService.streamText`'s agent-session branch or adding a second tool loop. Name one usage-accounting owner. Preserve approval and MCP behavior, frozen/live configuration rules, identity prompts, shell setup, tracing, commands/compaction, and native edit/fork checkpoints. Resolve the model bridge's documented thinking-replay metadata gap and state how unsupported content/attachments are represented before claiming parity.

Extend existing public-boundary tests in the [Pi runtime suite](../../../../packages/agent-runtime-pi/tests/runtime.test.ts), [Durable runtime suite](../../../../packages/agent-runtime-pi-durable/tests/runtime.test.ts), and [observation suite](../../../../packages/agent-runtime/tests/observation.test.ts). Host verification belongs with the existing runtime, archive-persistence, delivery, message-backend, and `useAgentSessionParts` tests; add focused projection/journal tests there as those components are introduced. SQLite tests use `setupTestDatabase()` and production migrations. Durable crash tests use an isolated worker process and persistent store, kill after an evidenced checkpoint without `shutdown`, and verify recovery in a fresh process. External tool effects are not assumed exactly once.

For implementation changes, run explicit affected test files and inspect `docs:affected`; update current reference docs only when their code path changes. Package tests and graceful close/reopen do not satisfy the Electron or crash-recovery gates. This documentation refinement itself runs only documentation, pairing, and scoped formatting checks.

## Alternatives considered

- Make `submit` return the only output stream: rejected because queued input, unsolicited native work, reconnects, and child streams do not share that lifetime.
- Add a second `Backend` abstraction or a string matrix for every native effect: rejected because the configured `AgentRuntime` already owns access, and consumers still need concrete native semantics.
- Put creation, tools, history editing, fork, resume, and delegation controls into the mandatory interface: rejected because current native capabilities and ownership differ. Keep typed adapter extensions until common use is established.
- Expose internal epochs, revisions, attempts, or raw SDK payloads: rejected because source mapping belongs to adapters and delivery/projection coordination belongs to the host; these fields would not create durable guarantees.
- Retry unknown input, dispose on last release, or simulate atomic idle admission with a local flag: rejected because each can lose evidence or race work the adapter does not own.

## Acceptance criteria

The [evidence note](../testing/2026-10-17-agent-harness-evidence.md) distinguishes current adapter validation, historical probes, and acceptance not yet run. Package validation does not establish complete host integration.

- AC1 — Repeated and concurrent opens share native ownership, validate identity, and never replace missing context by creating a new one. (verification: unit — Pi and Pi Durable runtime tests)
- AC2 — Input receipts preserve native admission evidence across busy policies, hooks, unknown results, late acknowledgement, deduplication, and release races. (verification: unit — adapter admission and host delivery tests)
- AC3 — Multiple observers see consistent source identity and snapshot-first ordered delivery; overflow, mapping loss, sink failure, and stop are explicit and isolated. (verification: unit — ThreadFeed and adapter projection tests)
- AC4 — Releasing one access does not stop another access or native work; shutdown closes the whole owned instance without claiming history deletion or unsupported execution recovery. (verification: unit — adapter lifecycle and persistent-store reopening tests)
- AC5 — Child observation survives the parent message, managed-child controls preserve native ownership, and native result delivery is not duplicated by observation. (verification: unit — adapter child tests and host projection integration)
- AC6 — Desktop callers preserve logical input receipts and archives, fence replaced observations, flush outstanding writes, and present native interruption/scheduling scope accurately. (verification: Electron — product-session runtime integration)
- AC7 — Identical or transformed inputs, batched steering, local command failure, undelivered input, truncation, and late receipts retain evidence-based attribution without text matching or false successful completion. (verification: unit — native Pi correlation probes and adapter/host input tests)
- AC8 — Populated-database migration preserves existing history; context associations and immutable input attempts survive partial native/DB success, and recovery neither replaces missing context nor blindly retries uncertain input. (verification: unit — context/input data tests with production migrations and native storage fixtures)
- AC9 — Child content persists independently of a parent assistant row; snapshot replacement and stale-observer writes cannot delete archives, duplicate recovered history, or overwrite a newer view. (verification: unit — host thread projection and archive-persistence integration tests)
- AC10 — A fresh Pi runtime restores a child's parent owner and relationship before continued input, preserves native stop/reporting policy, and never upgrades an unowned historical child into a writable root. (verification: unit — persistent Pi parent/child reopening tests)
- AC11 — A forced process death followed by fresh-process Durable reopening preserves input identity and native ownership; passive reconciliation starts no model/tool work, and permitted resume respects Harness scope without an extra host report. (verification: unit — Durable worker-process crash integration tests)
- AC12 — Root and child desktop flows preserve product authorization, model/tool boundaries, single usage accounting, delivery finalization, edit/fork associations, and documented stop/recovery behavior. (verification: Electron — Pi and Durable host integration scenarios)

## Risks

Exact assignment cancellation and host cross-harness orchestration remain proposals. Optional child/input fields make restricted access representable, but do not establish an adapter for every harness or grant controls from restored history. Pi child continuation requires the owner's loader and retains native reporting policy. Retaining contexts until shutdown increases memory use; uncancellable preflight can delay shutdown indefinitely. Normalized views omit native data and can lose intermediate events under backpressure. Durable logical-input mappings are not a replacement for a host journal. Treating any of these limitations as already solved by a shared type would make the abstraction stronger on paper than its implementations.
