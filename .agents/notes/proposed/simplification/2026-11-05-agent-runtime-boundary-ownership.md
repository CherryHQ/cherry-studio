# Agent Note: Complete runtime facts and consolidate desktop ownership

Status: proposed

English | [中文](2026-11-05-agent-runtime-boundary-ownership.zh.md)

## Problem

The 2026-11-05 audit at `48371df38d89a564aacffa86cd57177536518c1f` found the same boundary problem in the registered Claude Code, Pi, and Pi Durable runtimes: an owner has a complete association, exports part of it, and Main reconstructs the association with additional indexes. A count of `Map` and `Set` fields is not a correctness or simplification measure. The problem is multiple writers to the same fact and several independently maintained records for one lifetime.

The production paths are:

| Boundary | Current reconstruction | Owning code |
| --- | --- | --- |
| Submitted input | Each driver retains the full product input so a native ID can later return `messageSnapshot`, `headless`, and the original message to Main. | [Main input contract](../../../../src/main/ai/runtime/types.ts), [session owner](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts) |
| Child access | Configuration callbacks, tool results, native task events, and relationship events separately populate origin, readiness, handle, and projection maps. | [Pi connection](../../../../src/main/ai/runtime/pi/PiRuntimeConnection.ts), [Durable connection](../../../../src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts), [Claude connection](../../../../src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts) |
| Native control | Claude lifecycle and task receipts are interpreted again in Main; Durable polls pending inputs to compensate for independently delivered activity and input facts. | [Claude state](../../../../src/main/ai/runtime/claudeCode/ClaudeRuntimeState.ts), [Durable adapter](../../../../packages/agent-runtime-pi-durable/src/runtime.ts) |
| Content evidence | Claude's display decorator retains messages and constructs an archive; observation aliases and historical/live provenance travel through side channels. | [Claude metadata](../../../../src/main/ai/runtime/claudeCode/ClaudeMessageMetadata.ts), [root projection](../../../../src/main/ai/agentSession/ThreadProjection.ts), [child projection](../../../../src/main/ai/agentSession/ChildThreadProjection.ts) |
| Usage | Main combines raw Claude SDK stream frames into invocations before applying product pricing and attribution. | [Claude connection](../../../../src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts), [usage attribution](../../../../src/main/ai/agentSession/AgentSessionUsageAttribution.ts) |

The maintainer approved implementation of this follow-up on 2026-11-05, including the observation drain and cross-connection input-retention contracts. It remains proposed until the complete acceptance evidence is recorded. It partially supersedes the desktop input round-trip, child-access plumbing, and native-control placement in the [runtime contract](../architecture/2026-10-17-agent-runtime-contract.md) and [Claude migration](../architecture/2026-10-27-agent-runtime-claude-code.md). The [SDK content protocol](2026-10-29-agent-runtime-content-protocol.md) continues to own message representation, one content producer per native thread, and product persistence. Its delivered fixes and acceptance evidence are not reopened or relabelled as complete by this proposal.

## Proposal

### 1. Scope and ownership

Use the existing owners. Add no universal `BaseRuntime`, second session service, persistent submission ledger, capability matrix, or migration. Ordinary AI SDK chat and retired runtimes are outside scope. SDK upgrades, provider routing changes, schema redesign, and a general configuration refactor are also outside scope.

| Owner | Authoritative state | May pass across its boundary | Must not acquire |
| --- | --- | --- | --- |
| `AgentSessionRuntimeService` and its existing connection entry | Product input context, reply reservation, queue, connection generation, product turn transitions | Immutable native commands; callbacks correlated by input identity | Native task scheduling or interpretation of SDK frames |
| Existing runtime connection | Native access leases, product context binding, one resource record per observed child | Complete native facts to product projection and accounting | A second copy of input context or native task state |
| Native runtime/behavior owner in the package | Admission, placement, native input outcomes, child origin/readiness, native tasks, content and archive evidence | Typed values captured at the native boundary; supported native controls | Cherry database entities, window objects, pricing, or product message creation |
| `ThreadMessageProjection`, root/child product projections | Display decoration, source-to-product composition, retained product history and archive flush | Product messages and attachment snapshots | Native execution or a second native archive |
| Usage capture and attribution in Main | Frozen credential/pricing evidence, persisted charges, native-response-to-product ownership | Native invocation identity and accounting result | SDK stream reconstruction |

“Pass the complete object” means keeping a cohesive, immutable value together within its owner's scope. A child access result carries its relationship and handle together; an input's product attributes stay together in Main. It does not mean passing an entire service, database row graph, or mutable session object through every layer.

### 2. One Main owner for submitted input context

Put the pending product-input association on the existing session entry, outside its replaceable connected-state variant. It stores the original `AgentRuntimeUserInput`, including the captured snapshot and headless policy, under its `InputId`, together with its native context and originating connection generation. The generation fences callbacks; it does not determine how long the input survives. Do not reread a mutable message row to reconstruct these attributes later. The native package receives the prepared typed command, never the product entity. Inputs already owned by the existing turn, queue or child projection keep that owner; the pending association covers only the driver round-trip and transfers ownership rather than copying it into a second host ledger.

Change the Main driver callbacks and `steer-boundary` / `steer-undelivered` events to carry input IDs instead of returning full product inputs. The session owner resolves IDs once and transfers the complete inputs to its existing queue or steer-transition state. This replaces three driver implementations with one necessary host association; it does not eliminate the association itself.

The ordered protocol is:

1. Capture the product input and register it before calling `redirect` or `submit`; a native placement hook may fire synchronously.
2. Prepare and persist the existing native binding through `nativeSubmission`. Keep the current distinction between confirmed rejection, acknowledged admission, and unknown admission.
3. When Pi or Durable confirms placement, call the existing synchronous host hook with IDs before native execution can issue the next provider request. Main reserves the continuation reply identity using the stored full inputs. Do not replace this hook with asynchronous observation delivery.
4. Deliver the later typed input facts to Main. The existing reducer performs the visible reply transition and moves the full contexts into its transition record. Repeated facts reuse the same reservation; several inputs may share one response.
5. On confirmed non-admission or confirmed undelivered input, return the original context to the appropriate product path exactly once. On unknown admission, retain correlation and reconcile native facts; do not automatically resubmit or reinterpret a failed lookup as rejection.
6. On terminal delivery or transfer to an existing queue/transition owner, release the pending entry. Disconnect/replacement leaves unknown-admission input on the session entry. The successor reconciles it using its recorded native context and binding before transferring the original context or reporting the confirmed result; it never dispatches that input again. If the original native context is unavailable, keep the unresolved input and report the limitation. Fence old callbacks so they cannot mutate the successor or resolve its pending input. The existing durable binding does not reconstruct snapshot/headless attributes after process exit; this retention guarantee covers a living process, while restart follows the existing recovery policy.

Claude retains its native distinction: `command_lifecycle.started` is admission evidence, not proof of model placement. Its adapter joins command and response membership evidence and reports the evidenced boundary; Main must not synthesize `placed` to make it resemble Pi. The synchronous hook is required where native evidence exists before the next request; Claude accounting continues to use its evidenced response identity rather than a fabricated early placement.

Recovered native-only inputs have no old in-memory product context. Resolve their existing durable native binding where available; otherwise observe them as native input facts. Never manufacture a product input or mark the connection finished merely because the Main pending-context map is empty.

### Product reply handoff

The maintainer also approved completing product reply ownership. Allocate the full reply identity and frozen input context before asynchronous preparation. Keep delivery, native admission/completion, queued controls and local delivery failure on that reply in the existing reducer. Native completion and product preparation failure are separate facts. The reducer alone chooses a queued, steer, autonomous or deferred successor; service callbacks execute effects for their captured reply.

Use one preparation path for placeholder persistence, trace refresh and stream attachment. Retain the session-level unresolved input association, native response-to-reply usage join and context-level projection; remove `pendingResponseIds`, `pendingProjections`, `pendingDisplay` and the separate continuation/receive-only/deferred starters. Controls can attach through the connection's bound `contextId` before content exists. A checkpoint may reference another reply only after that reply's body commits.

After an admitted reply fails preparation or final persistence, its facts stay with it. Retry its own preparation on evidenced native completion/release; repeated failure stays retained without an automatic retry loop. Restore a deferred reply only after the original reply persists and native ownership is released. Preserve admission, author snapshot and headless policy, and never resend admitted input. Before-admission failure marks any created reply placeholder as error, terminates the held stream and leaves the saved user row for resend.

Closing retains the session owner and rejects new input until native observations and stream persistence drain, then performs the final projection flush. Failure retains retryable data and appears in backup's straggler report. Unopened placeholders must also settle, and late stream attachment is rejected during close. Successful final flush precedes ownership release; old preparation or terminal callbacks cannot advance a new reply. This does not add crash recovery for unsaved product context.

### 3. Child origin and readiness belong to the native owner

Extend the existing common `Subagent` relationship with optional evidenced creation origin. Keep it a stable relationship across child runs, not a task/run record:

```typescript
interface Subagent {
  readonly id: SubagentId
  readonly parent: Thread
  readonly child?: Thread
  readonly origin?: {
    readonly toolCallId: string
    readonly description?: string
  }
}
```

The tool call is scoped to `parent`, and means the creation call. A continuation call does not replace the child's identity or creation origin. Emit the same origin on live creation and native recovery. When native evidence cannot identify an origin, leave it absent; do not infer it from display text or the most recent tool call.

Adding origin alone does not solve opening a panel while configuration is pending. Add `openChild(toolCallId)` to each concrete `pi`, `durable`, and `claude` facet, with a typed result containing both the confirmed relationship and the concrete child handle. Keep the basic `ThreadHandle` access contract small. For example, the Pi facet returns this shape:

```typescript
openChild(toolCallId: string): Promise<OperationResult<{
  readonly relation: Subagent & { readonly child: Thread }
  readonly handle: PiThreadHandle
}>>
```

This operation opens access to an existing or already-creating child of the receiving parent. It never launches a task, submits input, resumes scheduling, or creates a replacement child. The lookup is scoped to the receiving parent and the creation call; a continuation keeps the original relation. If native evidence does not identify a unique child, return an explicit unavailable/unsupported result instead of choosing one. The native owner registers the creation attempt at native tool admission, before awaiting child configuration. A known in-flight creation call can therefore be awaited even before the child ID exists. Concurrent opens share that attempt and receive independently releasable access. A known attempt resolves when its child can be observed; an unknown call returns a typed error without an unbounded wait; creation failure, a completed call without a child, or owner shutdown settles the wait with the existing error result model. Missing/unavailable native evidence is reported honestly, not treated as a successful empty child or a reason to retry native work.

The adapters obtain origin from their existing authoritative sources: Pi's behavior/session creation record, Durable's conversation owner and behavior lineage, and Claude's structured task/parent/tool correlation. Move the Pi tool-result interpretation needed for readiness into this owner. `configureChild` still supplies native resources and policy, but no longer writes a Main relationship side channel. Task progress and outcome remain separate native facts; non-child background tasks remain supported.

Main can still open a known child by `Thread` for restored history. A creation-call lookup and a direct child open must converge on the same native owner and the same Main child resource record. Access release only releases access; stopping one child, interrupting the parent, and shutting down the runtime retain their distinct native meanings.

### 4. One Main resource record per child

Replace parallel `childHandles`, `childProjections`, and origin/readiness mirrors with one connection-owned record keyed by the full child `Thread` identity. The record contains the complete relationship, access handle, product context, projection, and in-progress opening/closing operation. Represent opening and attached states explicitly so partially initialized resources cannot look ready.

The adapter owns waiting before a child ID exists. Once access resolves, Main inserts the child record before asynchronous context/projection setup. Concurrent callers join that record; an unused duplicate access is released. Do not add another permanent Main map of configuration attempts. For nested children, resolve the actual parent product context from the returned relationship, not from the root by default.

On attach failure, release any resources acquired by that attempt and remove its failed opening record. Retain an existing saved history view and a visible diagnostic. The next attachment may retry opening/observation without resubmitting work. Once a record owns unflushed output, a flush failure must retain the record and retryable close state; deleting it would lose the only writer. These two failure cases must not be collapsed into one cached rejected promise.

A panel owns a subscription, not the native child. Closing a panel or finishing the parent's reply does not close the child record. Stop, backup/restore, connection replacement, and runtime shutdown continue through the existing writer barrier. First seal input and stop/drain native production where required, then await delivery and completion of every observation callback through the final native facts. Only then read the final archive and flush product state. No callback or projection write may run after that final flush; detach observation and release access last. A native execution promise or `Observation.stop()` alone is not this barrier: the current `ThreadFeed.stop()` discards queued delivery and does not join an in-flight callback. Preserve Claude's existing `observationEnds` guarantee until an equivalent delivery barrier replaces it. Backup/restore must hold the same write-free boundary until resume. Preserve engine-specific shutdown semantics and keep failed flushes observable.

### 5. Native facts arrive complete and in order

Keep engine-specific control facts on concrete facets; do not introduce a universal run state machine or expose untyped event dictionaries. Within each package, one owner interprets its SDK/native events. Main translates already-interpreted facts into its existing product events.

| Runtime | Package responsibility | Main responsibility after migration |
| --- | --- | --- |
| Pi | Join tool-call creation, child availability, behavior task state, placement, and settle evidence; publish typed child/task facts. | Bind product contexts, reserve reply identity synchronously, decorate tools and own tracing resources. |
| Durable | Reconcile accepted and recovered native inputs with committed outcomes, foreground work and compaction before reporting settlement. | Consume the completed fact set and perform product turn/persistence transitions. |
| Claude | Normalize command/response membership, session identity changes, native task lifecycle, autonomous work, permission denials and SDK invocation evidence. | Apply product reply transitions, interaction policy, display metadata and accounting. |

For Durable, add a concrete observation batch carrying the content/input facts and a foreground settlement result derived from the same authoritative native revision. Settlement is pending while relevant accepted or native-only inputs have no terminal/local result, or foreground execution/compaction is unfinished; unknown state cannot become success. Reconcile native submission records inside the adapter before publishing a settled result. Include the native identity/revision needed to distinguish a new settlement from a replay. Publish final input outcomes and content before the corresponding terminal fact. Background work and runtime-wide drain remain separate.

The maintainer separately approved the minimal SDK export patch on 2026-11-05: append exports for the existing `conversationViews`, `ConversationView` and `ViewObserver` to the repository's Pi Durable 1.4.0 patch. Public `watch` coalesces revisions and cannot establish this contract. The patch changes exports only, keeps the pinned version, and lets the adapter normalize submission outcomes against the same committed storage/view revision.

This lets Main delete `pendingInputs`, `refreshInputs`, and the native polling in `finishIfIdle`. It must not replace them with `activity === idle` or `hostPending.size === 0`. The native owner may still need an input index; merge it with the existing native input records instead of creating a second submission ledger. The shared `Activity` type continues to describe foreground activity only.

For Claude, normalize into a discriminated union in the existing owner/feed. Each migrated control fact carries its native identity and relevant input/response/task association together. Handle standard content in the existing SDK message projection. Move raw `command_lifecycle`, `result`, task receipt, and permission-denial interpretation out of Main, including the task parser's dependency on `ClaudeMessageMetadata`. Unmapped SDK variants must be explicitly classified as content, control, diagnostic, or intentionally unsupported with a reason in the adapter contract tests; do not silently cast them to a catch-all object.

Observation delivery must distinguish the first attachment baseline, subsequent native updates, recovery after a gap, and metadata-only refreshes. Capture aliases, retractions and provenance with the delivered batch; never fetch a mutable alias table after delivery has already advanced. Reuse Claude's concrete batch and add equivalent complete payloads to Pi/Durable facets. Change Main projection entry points to take this complete input value rather than a snapshot plus a guessed `liveSnapshot` flag and a separately read alias table. Pure typed field mapping at the connection boundary is acceptable; a second semantic reducer is not.

The first baseline loads history and current status without replaying historical turn completions or charges. A later overflow recovery must deliver previously unseen terminal/control facts after their corresponding body updates. Keep per-observation delivery position/deduplication in the existing native feed, keyed by native fact identity; compact acknowledged delivery state with the feed's existing retention policy rather than retaining every event forever; it is access-lifetime state, not another durable event log. A slow observer must not block native execution. If the feed cannot recover a necessary control fact, report a gap rather than fabricate completion. Main persistence remains idempotent under repeated facts; this does not promise exactly-once effects across process crashes.

### 6. Remove Claude's native archive and semantics from the display decorator

Use `handle.claude.archive()` as the source of committed native content for `ChildThreadProjection.readCommitted`. Preserve the existing Main committed-history consumer shape through a pure typed conversion of one captured archive result. Pi and Durable continue to read their native archives. Do not create a new archive service or make a display decorator an archive provider.

The Claude adapter applies permission-denied semantics to the affected SDK tool parts, retains explicit source retractions, and exposes aliases and legacy source associations with the archive/observation that owns them. Explicit retraction removes output even if the owning call is outside the selected view. Absence from a compacted/current view is not evidence to delete retained product history.

Delete `ClaudeMessageMetadata.messages`, `removed`, `legacy`, `denied`, and `archive()` once their consumers use these native facts. Keep the remaining decorator limited to product presentation such as MCP labels and product reminder visibility. Host-observed reasoning timestamps may remain as display timing state; label and preserve their current meaning rather than replacing them with unsupported claims about native reasoning duration. Move any remaining native-content interpretation into the adapter before deleting its Main copy.

Keep the raw/decorated views in `ThreadMessageProjection`: metadata can change without a content delta. Keep child composition, persisted product/native identity, tombstones, and checkpoint mapping where required to reconcile native current view with retained product history. These are different ownership domains, not duplicate native message stores.

### 7. Move SDK usage aggregation, keep accounting in Main

Claude's adapter combines SDK message/stream usage into a complete native invocation fact: stable invocation identity, native thread/response identity, model identity, evidenced token counts, completion/error state, and observed timing provenance. Partial stream and terminal assistant frames update one invocation record. Reuse the native owner and its response association; do not retain an independent Main aggregation implementation.

Main consumes these facts only for `usageCapture.owner === 'agent-sdk'`, freezes the existing credential/pricing evidence at the existing invocation boundary, and persists through the existing accounting service. A terminal-only fact is insufficient if it would freeze price or ownership too late; emit start/association evidence and later updates with the same identity. Do not interpret SDK session totals as additional invocations.

Gateway routes retain `provider-calls` as their sole capture owner. `AgentSessionUsageAttribution.owners/pending` remains necessary: a provider call can finish before its response is assigned to a product message. Persist session-owned usage immediately and later bind its existing record without changing the charge. This proposal adds no billing table or usage-ownership migration.

### 8. Explicit state removal and retention

| Current state | Target disposition | Deletion condition |
| --- | --- | --- |
| Pi `pendingSteers`, Durable `steers`, Claude `pendingSteers` | One pending product-context association on the existing Main session entry, surviving connection replacement | Synchronous reservation and context transfer use input IDs for all three drivers; unknown admission retains its original attributes until reconciliation. |
| Claude `startedSteers` | Native command/response association in the existing Claude owner | Main no longer interprets command frames to reconstruct a boundary. |
| Main `childOrigins`, `childRelations`, Pi `childReadiness` | Native relationship/access facts; one Main child record stores the returned value | Live, pending-configuration, nested and recovered access pass the same contract. |
| Main `childHandles` and `childProjections` | One resource record per child, retaining necessary handle/projection ownership | Open failure retry and final flush failure have distinct lifetimes. |
| Pi `childTaskStates`, Durable `childStates`, Claude task association maps | Native/behavior task records plus product presentation derived from facts | Child and non-child task status no longer require SDK/tool-result parsing in Main. |
| Durable `pendingInputs` and refresh polling | Existing native input records and revision-consistent settlement | Idle with pending native-only input cannot complete a product turn. |
| Claude metadata archive fields | Existing package archive/projection | Retraction, metadata-only denial, selected-view history and final flush contracts pass. |
| Claude `pendingInvocations`, lane and committed invocation indexes | One native invocation record/index in the Claude owner | External CLI usage stays idempotent; Gateway has no second writer. |
| Main `historical` / `seenNative` observation reconstruction and Durable `baseline` | Initial/recovery provenance and delivery tracking in the native feed | First baseline does not replay completion; overflow does not lose new terminal facts. |
| Pi `pendingBindings` | Candidate for direct synchronous binding, not a required architecture change | Remove only if failure/retry semantics are preserved; otherwise leave it. |

Retain the native owner registry, product/native identity mappings, usage attribution joins, raw/decorated views, native queues and close barriers, and tracing span ownership. Tool span/name/completion fields may share one tool resource record when they have the same lifetime; do not remove terminal deduplication merely to reduce a field count. Configuration authorization, MCP display catalog and model bindings retain their distinct owners.

### 9. Delivery sequence and review boundaries

This document is the proposed Spec. Publish/approve its exact revision before implementation under the repository's Agent Note workflow. The audit baseline is a source reference, not authority to rewrite all older stack layers. When implementation begins, verify the live stack and put each native producer change in its owning layer, followed by its desktop consumer; mergeable parent layers must remain independently valid.

| Stage | Focused change | Required exit evidence | AC coverage |
| --- | --- | --- | --- |
| 1 | Add evidenced child origins and concrete child-access operations to all three adapters. | Contract tests for pending configuration, concurrent access, nesting, cold history, failure and shutdown; no Main side effects needed to recover origin. | AC1, AC5 |
| 2 | Switch desktop child consumers and consolidate child resource records; remove relationship/readiness mirrors. | Independent child history, attachment retry, final flush retry, targeted stop and backup/restore barrier tests. | AC6, AC7 |
| 3 | Centralize product input context and migrate ID-based callbacks/events across the three drivers. | Before-next-request reservation, original context retention, several inputs per response, unknown admission and stale-generation tests. | AC2, AC3, AC4 |
| 4 | Complete native control/observation facts, including Durable settlement and Claude delivery provenance; delete Main native reconstruction. | Native-only pending input, initial baseline, slow observer overflow, terminal failure, autonomous work and retraction tests. | AC4, AC8, AC9 |
| 5 | Switch Claude archive/permission semantics and native invocation aggregation, then remove obsolete metadata/state fields. | Child archive reconciliation, metadata-only updates, external CLI usage and Gateway single-writer tests. | AC10, AC11 |
| 6 | Run affected desktop acceptance and remove remaining migration-only bridges. | Three-runtime Electron flows and the evidence record below; no parallel old/new producer remains. | AC12, AC13; cumulative review of AC1–AC11 |

Each consumer switch removes its old producer in the same stage. An additive package contract may precede its caller, but do not ship a compatibility flag, dual writes, or two authorities for a migrated fact. Do not combine the entire plan into one large rewrite. On regression, revert the affected consumer stage with its matching contract changes; do not keep both implementations running to mask uncertainty. No database rollback is required because this plan changes no persisted schema.

### 10. Verification plan

Start each stage with a contract test that fails for the actual defect or ownership gap, then change the producer and affected consumers. Assert resulting input, content, persisted state and resource behavior; do not certify the refactor with mock-call counts, field-count targets, or snapshots of current behavior. Database consumers use `setupTestDatabase()` and production migrations.

| Area | Existing test owners to extend/run with explicit file filters |
| --- | --- |
| Native contracts | `packages/agent-runtime-pi/tests/runtime.test.ts`, `startupObservation.test.ts`, `runtimeLifecycle.test.ts`; `packages/agent-runtime-pi-durable/tests/runtime.test.ts`, `pendingObservation.test.ts`, `recoveryConfiguration.test.ts`; `packages/agent-runtime-claude-code/tests/runtime.test.ts`, `observation.test.ts`, `projection.test.ts` |
| Desktop bridge | `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts`; `src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts`; `src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`, `desktopRuntime.integration.test.ts`, `ClaudeMessageMetadata.test.ts`, `ClaudeRuntimeState.test.ts` |
| Input, writer barrier and persistence | `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`, `agentSessionRuntimeState.test.ts`, `AgentSessionRuntimeService.child.test.ts`, `AgentSessionRuntimeService.handoff.test.ts`, `ChildThreadProjection.test.ts`, `AgentSessionArchivePersistence.integration.test.ts`, `AgentSessionUsageAttribution.test.ts` |
| Observable product result | `src/renderer/services/aiTransport/__tests__/ExecutionStreamOverlayService.test.ts`, `MessageProjectionService.test.ts`; affected runtime native contract probes against a scripted local endpoint |

For every code stage, run `pnpm change:scope --base <verified-base>`, inspect `pnpm check --plan --base <verified-base>`, and inspect `pnpm docs:affected --base <verified-base>`. Use explicit-file package/Main/renderer test wrappers, changed-file formatting/lint, and affected package builds/typechecks. Leave whole-project suites and platform packaging to CI. The table identifies affected consumers, not an instruction to rerun every file at every stage.

Final Electron acceptance uses an isolated profile and covers each runtime: open a child before configuration completes; observe it from two windows; continue it after the parent reply ends; reopen retained history; steer with captured product attributes; stop a child without stopping its sibling; hold backup/restore pause while child input is attempted. Also exercise a controlled attach failure and archive flush failure. Verify visible content and persisted rows, not only successful IPC calls. Scripted native probes are separate evidence from Electron rendering and do not establish live-provider quality.

The implementation was validated on top of `48371df38d89a564aacffa86cd57177536518c1f`. The producer/consumer switches, session-owned input retention, child resource consolidation, atomic Durable batches, Claude controls/archive/usage and observation delivery barriers are implemented. Focused regression and the Electron scenarios below are complete. This note remains proposed; the evidence does not claim full backup-file restore or published-stack acceptance.

| Evidence as of 2026-11-05 | Result and limit |
| --- | --- |
| Package builds/types and Main types | All four runtime packages built and typechecked; `pnpm typecheck:node` passed. |
| Focused regression | Input retention/reconnect, synchronous placement, child access, projection persistence, overflow recovery and usage suites passed with explicit test-file filters. The latest Durable desktop suite passed 22 tests, including native background completion followed by a blocked observation callback and a write-free final flush. |
| Pi Electron | An isolated profile and local scripted endpoint verified two-window child history/live observation, parent completion with active children, child continuation, targeted sibling stop, rejected child input during pause, blocked observation drain and final persistence. |
| Durable Electron | The final rerun passed two-window observation, continuation, targeted stop, pause rejection, blocked observation drain, final flush without later writes and retained history. The missing desktop `drainChildWrites` found in the first run is fixed and covered by 22 desktop tests. |
| Claude SDK and final drain | The maintainer approved the minimal SDK 0.3.311 event-forwarding patch on 2026-11-05. A byte comparison proves it only removes the 53-byte JavaScript iterator filter for existing host-only `session_state_changed` frames. SDK state bookkeeping, dependency version and CLI files are unchanged. The patched package passed 66 native tests and 25 desktop tests, including live backup drain and close with a blocked observer. |
| Claude Electron | Two windows observed independent child completion; native SendMessage continued the same child, targeted stop preserved its sibling, pause rejected child input, and a blocked callback held backup drain until release. Native idle then completed the drain without later writes, and both windows reopened retained history. |
| Failure and retry | Controlled Electron attachment failure preserved readable history. Its first retry exposed a missing saved-binding retry path; the repair failed the nested-child regression before the fix and passed afterward. Controlled archive failure blocked backup and close, retained the writer, and succeeded on retry without another provider request. |
| Verification boundary | Electron exercised the runtime pause/drain barrier shared by backup and restore, not ZIP export, file replacement or restore relaunch. Pending-configuration and captured-input attributes were checked in native/desktop tests; their timing was not independently controlled in Electron. The isolated SQLite ABI startup failure was recovered with authorized cleanup; later starts and normal shutdowns succeeded. |
| CI and platform scope | No remote CI, full-suite run, platform packaging, process-kill recovery or live-provider quality result is claimed. No performance or memory improvement is claimed. |

Focused commands include `pnpm test:main` with the explicit files in the table above, `pnpm test:agent-runtime packages/agent-runtime/tests/observation.test.ts` (9 passed), and `pnpm exec vitest run --project main src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts` (22 passed). The final Claude desktop run selected `desktopRuntime.integration.test.ts` and `ClaudeCodeRuntimeDriver.test.ts` (25 passed); the native run selected `runtime.test.ts`, `observation.test.ts`, `control.test.ts` and `projection.test.ts` (66 passed). Local Electron evidence and the scripted endpoint live under the ignored `.context/cherry-electron-dev/` directory. The broader AC12 acceptance limits above remain explicit; this note stays proposed.

The reply handoff follow-up uses real SQLite and production migrations in `AgentSessionRuntimeService.handoff.test.ts`. It covers content and usage before/after failed preparation, admitted and unadmitted deferred inputs, frozen author/headless context, early steer approvals, checkpoint exclusion, autonomous handoff during predecessor persistence, terminalization before submission, nested pause, blocked trace completion, close before stream attachment, blocked native close/stream persistence, and failed final-write retry without resend. Reducer tests separately cover swapped completion/release order and stale callbacks. The stream-manager barrier test waits for the captured persistence loop across replacement. These are automated host contracts, not new Electron, live-provider or process-kill acceptance evidence.

## Alternatives considered

| Alternative | Why it is not selected |
| --- | --- |
| Pass whole Cherry session/message/service objects into native packages | Reduces some lookups by making the native owner depend on product storage, pricing and windows; it fails recovery and dependency boundaries. |
| Extract the current maps into a shared manager or base class | Relocates fragmented ownership without completing the native boundary; one class would then have to interpret three native lifecycles. |
| Delete every map and derive everything from idle or the latest snapshot | Loses queued/native-only inputs, pending child creation, late usage association and archive flush obligations. |
| Introduce a universal run/task protocol or durable correlation ledger | Adds a second scheduler/state model and a migration without solving a required storage gap; native-specific facts already exist. |
| Extend only `Subagent` and leave consumers unchanged | Supplies origin but does not resolve readiness, input context duplication, control replay, or Claude's archive ownership. |
| Rewrite the existing content-protocol Spec | Blurs delivered content/persistence fixes with this still-proposed control and lifetime work; separate decision ownership is reviewable. |

## Acceptance criteria

- AC1 — Native packages contain no Cherry database entities, product pricing, window objects or product reply allocation; existing owners and schema are reused. (verification: unit — package builds and import-boundary checks owned by the implementation author)
- AC2 — Product input context has one Main owner; all three drivers report IDs and retain the original snapshot/headless attributes through queue, steer and failure paths. (verification: unit — session reducer and runtime service tests)
- AC3 — Pi/Durable placement reserves the reply before the next provider request; repeated facts and several inputs per response cannot allocate duplicate replies, and Claude started is not misreported as placed. (verification: unit — native probes plus desktop bridge tests)
- AC4 — Unknown admission followed by disconnect, reconnect and confirmed outcome preserves the original snapshot/headless attributes without resubmission; native-only recovered input and old callbacks cannot cause premature completion or mutate a successor connection. (verification: unit — adapter and session service tests)
- AC5 — All three adapters provide evidenced child origin and access across pending configuration, nesting, continuation and cold history; unavailable evidence preserves readable history with an explicit limitation, and opening or releasing access does not launch or stop execution. (verification: unit — runtime contract tests)
- AC6 — One Main child record owns access and projection; failed attach can retry, while failed final flush retains retryable output and does not create a second writer. (verification: unit — child projection, archive persistence and desktop bridge tests)
- AC7 — Child input and final writers obey pause/drain; close/backup waits for blocked observation callbacks and final facts before its final flush, with no subsequent projection writes until an explicit resume. Parent completion and panel detach do not terminate independently running children. (verification: unit — runtime lifecycle and pause/child service tests)
- AC8 — Durable idle with unresolved native inputs or compaction cannot complete a product turn; ordered settled evidence preserves terminal failure. (verification: unit — Durable package and connection tests)
- AC9 — Initial attachment does not replay historical completion/usage; overflow recovery delivers unseen control facts after their body and reports unrecoverable gaps honestly. (verification: unit — adapter observation and desktop integration tests)
- AC10 — Claude permission denial, explicit retraction, aliases and committed child content come from the native adapter; metadata-only updates remain visible and compaction does not erase retained product history. (verification: unit — Claude projection, metadata and child archive tests)
- AC11 — Claude SDK invocation aggregation has one native owner; Main preserves pricing timing, idempotent persistence and delayed response ownership, with Gateway remaining a single capture path. (verification: unit — Claude desktop and usage attribution tests)
- AC12 — Multi-window child observation, continuation, history, steering, targeted stop and backup/restore work for Claude Code, Pi and Pi Durable. (verification: Electron — isolated-profile scenarios recorded by the implementation author)
- AC13 — Migrated native facts have one producer; the listed Main mirrors and raw control parsers are removed, retained state has an explicit owner, and references match the implemented boundary. (verification: docs gate — producer/consumer search, changed-scope inventory and bilingual documentation checks)

- AC14 — A product reply owns its complete identity before asynchronous preparation; content, controls and usage retain that owner after preparation/persistence failure. Predecessor persistence, native release and stream drain form separate handoff conditions; deferred input is not resent, old callbacks cannot advance a successor, and close settles unopened placeholders. (verification: unit — real-SQLite handoff tests, reducer tests and stream-manager barrier tests)

## Risks

| Risk | Required protection |
| --- | --- |
| Native APIs expose less evidence than the target contract needs | First prove the behavior through the installed adapters and scripted native probes. Keep missing origin, unknown admission and unrecoverable gaps explicit. A required upstream SDK change is a separate maintainer decision; do not compensate with Main heuristics. |
| Child configuration, observation and shutdown race | Register native creation before asynchronous configuration; settle all waiters on failure/shutdown, release losing accesses, and retain the final writer until persistence succeeds or its failure is surfaced. |
| Removing input mirrors changes reply timing or user attributes | Register before dispatch, preserve the synchronous reservation hook, transfer the captured full context, and fence late callbacks by connection generation. |
| Consolidation merely relocates duplicate state | For each removed field, identify the existing authoritative native record or the one retained product/resource record. Reject a new manager that copies both sides. |
| Baseline or overflow handling replays old completion or drops new completion | Capture native identity and provenance with the batch, preserve body-before-terminal ordering, bound delivery history, and test slow observers plus a subsequent submission. |
| Usage normalization freezes price late or records Gateway calls twice | Preserve invocation-start evidence and the existing single capture owner; test native identity, stored charge and delayed message binding separately. |
| A broad refactor obscures recovery regressions | Deliver the focused stages above, keep old content/checkpoint contracts intact, and rerun only the checks invalidated by each stage. Report adapter, SQLite, Electron, restart and CI evidence separately. |

No performance benefit is assumed from fewer maps. Success is fewer independent interpretations and synchronization paths with the same observable behavior. Any SDK limitation that blocks a required acceptance criterion must be resolved in the owning contract and reviewed before its consumer stage proceeds.
