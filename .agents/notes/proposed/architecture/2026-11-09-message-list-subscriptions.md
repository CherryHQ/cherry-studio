# Agent Note: Incremental persistence, timeline projection and message-list subscriptions

Status: proposed

English | [中文](2026-11-09-message-list-subscriptions.zh.md)

## Problem

At Cherry `ab83909a7c637c81c6d59221f76d1aad919d2add`, Home and Agent merge complete live assistants into list inputs. Local steer segmentation changes synthetic IDs at acknowledgment/native handoff, clones message/part wrappers and retains settled projected IDs as live. This expands updates, can remount content and can keep completed content out of search. The main reply persistence listener saves on success/pause/error rather than individual part completion.

This proposal partially succeeds the renderer portion of [native steer](https://github.com/CherryHQ/cherry-studio/blob/ab83909a7c637c81c6d59221f76d1aad919d2add/.agents/notes/proposed/bug-fix/2026-11-09-agent-native-steer.md). Native priorities, admission, loop ownership and its AC1–AC11 remain there. The [stream replay handoff](../../implemented/bug-fix/2026-10-22-stream-replay-handoff.md), [scroll-area convergence](../simplification/2026-11-04-unified-scroll-area.md) and [code-block surfaces](2026-10-26-message-code-block-surfaces.md) retain their owners. The proposal is not implemented and does not claim Spec-head Approval or performance gains.

## Proposal

### 1. Final shape and ownership

```text
Provider / SDK events
  -> existing runtime/source owner
  -> in-memory parts with stable IDs
       -> per-part subscribers
       -> part onDone: persist that part
  -> message completion: terminal state and statistics

SQLite: message container + message_part + existing tool outputs
History: message page -> batch-load ordered parts -> existing message API
UI: stable part references -> derived timeline rows -> existing viewport
```

A product message is a container, a part is the content/update/persistence unit, and a timeline row is a derived presentation. Native execution ownership does not change when presentation changes. Keep built-in text/reasoning/tool parts and the existing typed [DataUIPart map](../../../../src/shared/data/types/uiParts.ts); do not create a parallel TurnItem content model, timeline table or SDK-frame event archive.

| Owner | Responsibility |
| --- | --- |
| Existing runtime adapters/session owner | Normalize real native facts; own input placement, execution, activity and semantic part completion |
| `RootMessageProjection` and existing source projections | Native-to-product mapping, stable part IDs, in-memory bodies and source checkpoint |
| Existing message/context data services | Persist containers, independent parts, existing split tool outputs and required source metadata |
| Main `MessageProjection` / `ProjectionSubscriptions` | Publish consistent snapshots/patches and manage window leases; no SQL or execution control |
| Renderer transport / topic facade | Existing attach, attempt filtering, live source retention and history/live selection |
| Scoped message-list projection | Group stable parts into rows and expose keyed immutable reads; no canonical body accumulator |
| Existing viewport runtime | Navigation intent, measurements, following/reading and position restoration |

Shared types contain persisted part/DataUIPart contracts and wire facts, not React rows or mutable stores. Renderer-only row types stay with the message-list contract. A shared pure presentation helper is appropriate only when both processes actually consume the same source-neutral rule; it does not justify another manager.

### 2. Independent part storage and completion writes

For agent sessions, retain `agent_session_message` as the container and add `agent_session_message_part` through an appended migration. Ordinary Chat keeps its existing storage adapter until explicitly migrated; all surfaces can still consume the shared rendering contract.

| Store | Content |
| --- | --- |
| Message container | ID, parent/branch relation, role/model, terminal state, attribution and statistics |
| Message-part rows | Stable ID, owner message ID, explicit order and current typed payload |
| Existing tool-output store | Latest split output under the existing message/tool-call identity |
| Existing checkpoint | Native/source associations and recovery metadata, without body copies |

API callers still receive assembled `message.parts[]`. The part table is the sole persisted body source after migration; remove the old stored array and switch readers/writers together. There is no permanent dual-write or runtime fallback between two body authorities. Backfill existing arrays in order, allocate IDs once and preserve message/branch relations, private non-part metadata, tool references and blob envelopes without hydrating tool full output.

Deltas update the current in-memory part and notify its subscribers. Persist that individual part at its own semantic `onDone`, not at the whole assistant reply's `onDone`. Reply completion waits for required saves, then updates container status/statistics; it does not rewrite saved parts. Stop/error saves received content and actual state of unfinished parts before settling the reply. User input acceptance remains an immediate write. There are no scheduled body checkpoints, per-token writes, historical part versions or generic part-replacement protocol. An abrupt Main crash may lose the current unfinished part; committed completed parts remain recoverable. Renderer reload with Main alive can reattach to newer in-memory content.

Related part/result/source-mapping changes use the existing synchronous SQLite transaction. Prepare async blob/native checkpoint work before it, and publish after successful commit. Reuse existing session/attempt guards for stale completion, deletion and fork; no separate batch scheduler is introduced. Part saves do not trigger reply auto-name/usage settlement. Search responds to relevant text/finalization, not tool/hidden-part updates; migrate the old JSON/FTS triggers with storage. Maintain file references only as needed and preserve files referenced by other parts. Measure large single-part serialization and completion writes; independent rows do not imply zero-copy persistence.

Reuse [tool-result #23909](https://github.com/CherryHQ/cherry-studio/pull/23909) and [database #23873](https://github.com/CherryHQ/cherry-studio/pull/23873). The inspected implementation head is `f89b6762dae797db222e97ec75e9f53a08391308`, not code already present in this worktree. Its [owning note](https://github.com/CherryHQ/cherry-studio/blob/f89b6762dae797db222e97ec75e9f53a08391308/.agents/notes/implemented/architecture/2026-11-09-tool-result-projection-boundaries.md) retains accepted immutable snapshots, reused serialization, latest-output overwrite, targeted invalidation, bounded detail reads and cache lifetime. Do not add result revisions, content hashes, history-addressable outputs or duplicate stores. Preliminary/replacement results follow that existing latest-value contract; completion does not establish historical immutability.

### 3. Stable identity and part-level steer

| Identity | Rule |
| --- | --- |
| User message | Allocate a valid UUID before submission; optimistic and persisted message share it |
| Product assistant | Main reserves its message ID once; it is not a continuation display key |
| Content/tool part | Use a stable persisted part ID and existing native source/tool-call association; append/state changes preserve it |
| Boundary DataUIPart, if needed | Derive from accepted user ID and boundary kind; no random ID per render |
| Continuation row | Derive from the boundary/input identity; successor arrival changes bindings, not its key |
| Transport revision/generation | Existing ordering/stale-event controls; never part of a content or React key |

The renderer currently generates a draft `presentationId` without sending it, while Main independently generates `userMessageId`. Carry the once-allocated user message ID through the submit request and reuse the existing native `inputId = message.id` association. Validate UUIDs, target and authority at the boundary. Same-input repeats resolve to existing acceptance; conflicting IDs must not overwrite unrelated input or silently submit again. Unknown delivery is not permission to replay. Compare immutable submission facts, not mutable parts to which application metadata may have been added.

Native identities are context-scoped. When native part identity is unavailable, allocate a product part ID once and save its source mapping. Append and tool preliminary/final updates update the same part; actual new blocks create new parts, and explicit removal removes the referenced part. Reuse existing update/alias facts instead of inventing text matching, hashes, index-based identity or a replacement protocol. Read old root checkpoint offset/count composition as legacy mapping, not character ranges.

```text
input U1 -> boundary B1 = boundary(U1) -> continuation(B1)
ack U1: same IDs
successor A2: add its source parts to continuation(B1), do not rename it
tool T1: same stable part/tool identity from running to final result
next input U2: distinct boundary B2 and continuation(B2)
```

Follow T3's item-level semantics: retain existing part identity, keep completed parts before steer, regroup ongoing tools as whole parts and place new subsequent parts after the input boundary. Existing same-part deltas update that item; do not split it at a send-instant character offset. No universal `from`, `textCuts`, UTF-16 offsets, `carry` lists or character-lineage machinery. Consecutive steer order comes from accepted inputs and source relations, with only a demonstrated missing association persisted.

Use a DataUIPart only for a necessary presentation/lifecycle fact not already represented. A boundary stored on a user message is finalized at acceptance before native input binding and stays immutable; later successor associations use existing checkpoint/source records, preserving the input lock. Hidden presentation parts do not enter model input or create empty assistant headers. Existing content/hidden parts retain their consumers, and `data-retry` stays transient. Compaction updates its existing operation marker at the original source anchor; interrupt uses the compact-style centered separator and retains actual output. No waiting label or fabricated empty assistant reply.

Composer and timeline consume existing activity and input-disposition facts for local, queued and external deliveries. Busy alone is not a native-placement signal. Keep origin and durable input identity; do not add a parallel admission algorithm. Queue-to-steer promotion preserves input identity. The one-pending-steer policy remains in the native-steer owner. Rendering, observing or saving never interrupts/restarts the agent loop.

### 4. Renderer reads and lifetime

```typescript
interface MessageListProjection {
  getRowKeys(): readonly MessageRowKey[]
  subscribeRows(listener: () => void): () => void
  getRow(key: MessageRowKey): MessageRowDescriptor | undefined
  subscribeRow(key: MessageRowKey, listener: () => void): () => void
  getPart(id: MessagePartId): CherryMessagePart | undefined
  subscribePart(id: MessagePartId, listener: () => void): () => void
}
```

These are conceptual target signatures, not shipped APIs. A row descriptor holds kind/group metadata and ordered whole-part IDs. Removed rows/parts read as absent. Keep snapshots and arrays referentially stable until their observable value changes. Text updates notify only the affected part; part membership/order changes notify the owning descriptor/topology; status/footer changes notify their own consumers. Reverse indexes locate affected views without rebuilding all history. Apply related source/binding/index changes before notifying so readers never see a half-updated projection. Open text does not repeatedly rebuild row descriptors.

| Layer | Retained state and lifetime |
| --- | --- |
| History hooks/SWR | Persisted pages, cursors, loading/errors and existing lazy reads |
| `MessageProjectionService` | One shared IPC baseline/patch stream per target/window, gap recovery and refcounted detach |
| `ExecutionStreamOverlayService` | Existing attempt filtering, live parts and one history/live selection path; immutable page references, not another history cache |
| Scoped list view | Row/group descriptors, part references and reverse indexes for one selected view/branch |
| UI state | Selection, editing, disclosure and viewport state under existing bounded owners |

One view hook acquires/releases the facade and registers history-page references. Providers/cards only subscribe; they do not acquire a second connection. Disposing the list drops its derived listeners/indexes; final consumer release detaches renderer observation without cancelling Main work. Preserve Activity hide/show, branch/topic owner guards and late-page rejection. Context carries stable store/action handles, not a complete changing message map. Services never import component-local row types.

Keep compatible group/row/part component structure through acknowledgment, successor association and history handoff. Tools subscribe to their own stable part ID; detail consumers retain the existing bounded on-demand path and separate loading from execution state. A key alone cannot preserve DOM across a real parent change: verify any deliberate steer regrouping for disclosure, approval, focus and selection, using source-scoped UI state where needed. This is an implementation check, not a separate product choice or a mandate for portals.

Keep Virtua, Streamdown, stable renderer/plugin configuration and existing viewport hooks. Reuse completed Markdown blocks when semantics are unchanged; later delimiters may legitimately change the active parse region. Preserve the live edge in following mode and the semantic anchor/offset in reading mode. Local send emits one navigation intent; ack, saves and successor binding do not emit another. Measure natural content growth separately from remounts and unexpected anchor movement. Do not mandate global observers or `flushSync` without a reproduced gap.

### 5. Simple completion, cleanup and history reads

Save succeeds before Main publishes successful completion. Renderer refreshes persisted history and releases only the corresponding settled live content after refresh success, retaining existing attempt/topic guards. If saving or refresh fails, keep readable live content and report the existing recoverable error; do not clear it in `finally` or re-execute tools. Preserve newer active parts and ignore stale callbacks. Reuse this lifecycle sequence; add no persistence-proof protocol, durable cursor, body-version counter or commit-receipt subsystem. Existing transport revision remains for duplicate/gap recovery and snapshot reattach.

Deletion/fork use the existing session operation and native checkpoint boundaries; completion guards prevent late writes from recreating deleted content. Partial storage is not automatic tool-resume authority. Do not introduce another lock/queue manager for hypothetical races; test actual affected interleavings.

History pages messages and batch-loads their complete ordered parts, keeping tool full output deferred. A demonstrated direct part reference can use a targeted ID read; no generic cross-page dependency graph/resolver is required. Existing accepted facts drive presentation, without invented legacy steer cut points. Fork uses real native/product checkpoints, not UI row keys. Export/search/capture reuse existing message/part read and assembly entrypoints rather than independently rebuilding sources or routing everything through the UI timeline. Capture/copy of a visible selection follows its selected part IDs/order; explicit full export preserves canonical content. Deduplicate canonical delete targets and count usage once, even when display grouping differs. Keep multi-model/branch semantics and explicit action capabilities.

### 6. Implementation placement and removal boundary

| Location | Change |
| --- | --- |
| `src/shared/data/types/uiParts.ts` and existing message types | Minimal typed data-part facts and stable part contract; preserve model filtering/transient policies |
| `src/shared/ai/messageProjection.ts` and existing IPC routes | Existing snapshot/patch/revision contract; add required part identity/change facts, no second protocol |
| `src/main/ai/agentSession/RootMessageProjection.ts` and runtime adapters | Stable native/product part mapping, in-memory updates and actual part completion callbacks |
| `src/main/data/services/AgentSessionMessageService.ts`, context service and schemas | Part table/migration, per-part saves, batched assembly, file/search adaptation and existing tool-result integration |
| Existing persistence backend/listener/runtime owner | Part completion saves; ordered reply completion and Stop/error settlement; no timer-based writer service |
| `src/main/ai/messages/MessageProjection.ts`, topic/child projections | Reuse changed immutable parts and publish affected updates; no complete-view cloning/hash as a necessary text hot path |
| `src/renderer/services/aiTransport/*` | Existing transport/facade lifetime and keyed source reads; import through the current public barrel |
| `components/chat/messages/types.ts`, provider/list/frame/blocks | Scoped derived row view and keyed leaf reads; keep services independent of component types |
| Existing page runtime hooks/adapters | Compose selected target, history, capabilities/actions and one acquired source handle; no full live-body merge per delta |

Create private helpers only when actual size/cohesion warrants them; do not pre-create a TimelineService, ProgressWriter manager or new process-root directory. Existing lifecycle owners own retained resources. Migrate consumers then remove local held steer boundaries, synthetic `CherryUIMessage` continuations, singular source aliases, parsed index IDs, projected-ID live unions and aggregate body subscriptions. Remove obsolete `useMessageStreamingLayers` assembly only after keyed history/live, citations, auto-read and error consumers move; keep useful cold read helpers and unrelated capabilities.

### 7. Migration and verification units

| Phase | Scope | Proof |
| --- | --- | --- |
| 1. Storage/identity | Add part records; migrate arrays; retain latest tool-result contract; switch the sole body source/read assembly | Populated SQLite migration, ordered round-trip, branch/fork/file cleanup and input-lock tests |
| 2. Completion persistence | Per-part `onDone`, reply terminal/Stop/error sequence and existing refresh cleanup | Completed-part recovery before reply completion, no delta writes, failure retention and actual stale-completion tests |
| 3. Keyed Agent rendering | Stable input/part/row identity, source handle lifetime and part subscriptions; remove replaced local paths | Ack/handoff/repeated input, unaffected snapshots, activity-only notifications, two-window/reattach and action tests |
| 4. Shared consumers | Home multi-model/history and remaining list consumers; paging, source-aware actions and cold reads | Consumer audit, explicit affected tests, full-copy/capture/selection and no duplicate subscriptions |
| 5. Real interaction | Existing viewport/Markdown/tool transitions; fix only measured gaps | Real Electron Claude/Pi/Pi Durable steer/queue/compact/Stop/external input and follow/read/focus geometry |

Use explicit test files and `setupTestDatabase()` for SQLite. Synthetic replay proves data/notification contracts; real Electron proves integration and geometry. Compare the same fixtures/build/viewport, recording notification/render/mount counts separately from CPU/frame/layout and memory. Measure long history, stable large results plus text, metadata-only changes, media sizing, prepends and topic switches. No unsupported FPS, zero-remount or indefinite no-leak claim; native compliance and OS/package coverage are separate evidence.

### 8. Reference evidence and remaining limits

T3 references use `c6ca6056309904f89b90b6055d797973be0a0939`: [ID allocation](https://github.com/pingdotgg/t3code/blob/c6ca6056309904f89b90b6055d797973be0a0939/packages/provider-core/src/server/IdAllocator.ts), [item-level steer grouping](https://github.com/pingdotgg/t3code/blob/c6ca6056309904f89b90b6055d797973be0a0939/apps/web/src/components/chat/MessagesTimeline.logic.ts#L1033), [quiet structure and keyed text](https://github.com/pingdotgg/t3code/blob/c6ca6056309904f89b90b6055d797973be0a0939/packages/client-runtime/src/state/threadDetail.ts#L354), [transaction/publication](https://github.com/pingdotgg/t3code/blob/c6ca6056309904f89b90b6055d797973be0a0939/apps/server/src/orchestration-v2/EventSink.ts) and [search-index gating](https://github.com/pingdotgg/t3code/blob/c6ca6056309904f89b90b6055d797973be0a0939/apps/server/src/orchestration-v2/messageSearchIndex.ts). The earlier renderer exploration used `d5290e9167ccbd8d2c7043eab8e311fd21a14464`; neither source snapshot is Cherry runtime proof.

The [message-list rules](../../../../src/renderer/components/chat/messages/README.md), [projection transport](../../../../src/renderer/services/aiTransport/MessageProjectionService.ts), [topic facade](../../../../src/renderer/services/aiTransport/ExecutionStreamOverlayService.ts), [persistence listener](../../../../src/main/ai/streamManager/listeners/PersistenceListener.ts) and [viewport runtime](../../../../src/renderer/components/chat/messages/list/chatVirtualizerRuntime.tsx) remain implementation owners. Existing steer videos/tests and the tool-result dependency's report prove their own heads only. This proposal has not run a schema migration, new runtime acceptance or benchmark.

## Alternatives considered

- More local snapshots/aliases or a renderer event store: duplicates source ownership and leaves identity/reload divergence.
- Character slicing and generic boundary lineage: unnecessary for accepted item-level behavior.
- A parallel TurnItem model, timeline table or full T3 event log: duplicates existing parts/facts and adds replay/retention obligations.
- Keep terminal-only full-message JSON: mismatches the chosen independent part persistence unit.
- Keep dual authoritative bodies after migration or indefinitely retain obsolete aggregate APIs: leaves update ownership and deletion boundaries unresolved.
- Result history/revisions/hashes or a second tool store: superseded by the existing latest-result dependency contract.
- New commit-proof/receipt/version or cross-page dependency systems: existing completion/refresh and ordinary reads satisfy the chosen scope.
- Replace Virtua/Streamdown or mandate observer/flushSync machinery: requires measured library/host limitations, not assumed fixes.

## Acceptance criteria

- AC1 — Text-only updates preserve row topology and unrelated part references; only the affected part subscriber is notified (verification: explicit projection/facade/list tests — renderer owner)
- AC2 — Activity, approval, footer usage and terminal changes remain visible when body bytes are unchanged (verification: keyed status/component tests — renderer owner)
- AC3 — Ack and native handoff preserve continuation identity and compatible tool subtrees without duplicates (verification: mount/focus assertions and real Electron — renderer owner)
- AC4 — Whole-part regrouping/replacement/removal preserves provenance and never selects an unrelated array-index part (verification: source projection replay — projection owner)
- AC5 — Accepted whole-part grouping reconstructs after reload/two-window observation; unknown/rejected input never auto-replays (verification: persisted-part and Electron reattach tests — Main/renderer owners)
- AC6 — Save/refresh failure retains readable output; successful save and refresh precede settled live cleanup (verification: failure-injection and history/overlay tests — Main/renderer owners)
- AC7 — Copy/capture use selected part order, full export preserves content, deletes deduplicate source IDs and fork uses real checkpoints (verification: existing affected action/read tests — integration owner)
- AC8 — Existing follow/read anchors survive prepend, disclosure, async media, resizing and competing navigation (verification: real browser/Electron geometry — viewport owner)
- AC9 — Compaction stays at its source anchor; interruption is a centered separator and actual output is retained (verification: focused frame/projection and native compact/Stop — renderer owner)
- AC10 — Detach, Activity hide/show, revision gaps, stale attempts and topic switches do not duplicate observation or cancel/reopen work (verification: lease/recovery tests and Electron — transport owner)
- AC11 — Home multi-model/branch and shared consumers preserve behavior; replaced aggregate/alias/index-ID paths have no callers (verification: import audit, scoped typechecks and affected tests — integration owner)
- AC12 — Focus, selection and motion preferences survive supported transitions; profiles separate counts from CPU/layout/memory (verification: browser checks and same-fixture profiles — verification owner)
- AC13 — Completed committed parts recover before whole-reply completion; crash may lose the active unfinished part and does not replay tools (verification: populated-DB/restart tests and runtime acceptance — Main owner)
- AC14 — Necessary boundary facts are saved at acceptance, hidden from model/content and immutable after input binding; ordered legacy history remains readable (verification: SQLite/input-lock/model-filter tests — data/runtime owners)
- AC15 — Local, queued, compact-time and external inputs use existing unified activity/disposition facts without fabricated waiting messages or loop interruption (verification: deterministic matrix and real native traces — runtime/renderer owners)
- AC16 — Subscription callbacks observe complete installed source/binding snapshots, never intermediate row/body combinations (verification: notification-time consistency and refresh race tests — projection owner)
- AC17 — Pure append retains completed Markdown DOM and stable tool/part keys; handoff does not add navigation or lose reading anchors (verification: explicit DOM/mount and Electron geometry tests — renderer/viewport owners)
- AC18 — Stable user/part/tool/boundary/continuation identities survive ack, queue promotion, successor binding and reconnect; real new content gets new identity (verification: schema/key/source and Electron traces — shared/Main/renderer owners)
- AC19 — Migration leaves one ordered part body store, preserves branches/tool/file refs and API assembly; one-part writes do not rewrite other completed parts/results (verification: populated migration/transaction and consumer tests — data/Main owners)
- AC20 — Deltas write no body rows; each part onDone persists independently, reply completion updates terminal/statistics, and Stop/error saves unfinished content without a periodic checkpoint (verification: explicit completion/Stop/error SQLite tests — runtime/data owners)

## Risks

Native completion granularity and stable identity must come from actual source facts; missing capability is fixed in the existing adapter rather than guessed from UI timing. Input-only UI parts must stay excluded from model input. Migration must preserve existing users and relations, and large individual parts still have serialization cost.

Fine-grained subscriptions can hide metadata changes or leak if equality/lifetime handling is wrong. Tool regrouping can reparent DOM despite stable IDs; preserve actual state/focus/selection and measure geometry. Retention remains bounded; current-state storage does not promise historical event queries, exact character splits or zero-loss active-part recovery. Reference source and focused unit tests do not prove native compliance, packaged behavior or all-platform performance.
