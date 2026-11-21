# Agent Note: Agent session runs, ordered items, change cursor, and context transfer

Status: proposed

English | [中文](2026-11-19-agent-session-timeline-and-context-transfer.zh.md)

## Problem

Agent sessions need three things the current model cannot express together: an orchestrator that moves a conversation to another harness or model, history reads and rendering that touch only what changed, and a run timeline in which a steer forms a stable boundary.

At Cherry `a83cd16c826bbd01b28ebe968e0015f5edd7b8ee`:

- One assistant row is one product reply spanning many native messages. [RootMessageProjection](../../../../src/main/ai/agentSession/RootMessageProjection.ts) maps native sources to rows through `checkpointMapping.root` entries of `{ messageId, offset, count }`; [ChildThreadProjection](../../../../src/main/ai/agentSession/ChildThreadProjection.ts) keeps an index-based `composition`.
- A steer rolls the reply. At native placement, `reserveSteerContinuation` in [AgentSessionRuntimeService](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts) settles the current reply and opens a continuation row under the steer. The renderer keys parts by array index (`${message.id}-part-${index}` in [MessagePartsRenderer](../../../../src/renderer/components/chat/messages/blocks/MessagePartsRenderer.tsx)).
- [MessageProjection](../../../../src/main/ai/messages/MessageProjection.ts) coalesces for 80 ms, deep-compares whole messages and sends the full order. Agent history pages refetch on each data change ([useAgentSessionParts](../../../../src/renderer/hooks/useAgentSessionParts.ts)). Markdown re-splits the whole text on every update and memoizes blocks by content ([parseLatexMarkdownBlocks](../../../../src/renderer/components/markdown/parseLatexMarkdownBlocks.ts)).
- Changing the model within a harness keeps native history: pi-ai `transformMessages` adapts Pi and Pi Durable messages, and the Durable connection rebuilds on the same conversation. Changing the harness is unsupported: drivers reject a branch bound to another runtime ([durableContext](../../../../src/main/ai/runtime/piDurable/durableContext.ts)), and the proposed [session runtime binding](https://github.com/CherryHQ/cherry-studio/blob/a74bb2dd95182cc9f063cac9798b4bdbb2590a8b/.agents/notes/proposed/architecture/2026-11-12-session-runtime-binding.md) makes the binding immutable.
- Product history reaches a harness only through [readSessionHistory](../../../../src/main/ai/agentSession/sessionHistory.ts), which DeepSeek import relies on. It runs only when no prefix row carries native identity, sends the whole path without a total budget, and records nothing about what was delivered.

This note specializes the [runtime contract](2026-10-17-agent-runtime-contract.md). It partially supersedes the steer, part identity and cursor sections of [message-list subscriptions](https://github.com/CherryHQ/cherry-studio/blob/f65c54cd6069caf5b1efa3c99ea1fe08ce543645/.agents/notes/proposed/architecture/2026-11-09-message-list-subscriptions.md), the renderer cut model of [native steer](https://github.com/CherryHQ/cherry-studio/blob/ab83909a7c637c81c6d59221f76d1aad919d2add/.agents/notes/proposed/bug-fix/2026-11-09-agent-native-steer.md), and the immutability rule of session runtime binding. [Tool result boundaries](../../implemented/architecture/2026-11-09-tool-result-projection-boundaries.md) is unchanged: its publication revision stays a delivery sequence, separate from the storage cursor below.

## Proposal

### 1. Run owns execution and Timeline owns content

A run begins when the harness places its triggering input and settles at its native terminal. The existing assistant row is its physical record. Its ID is the run ID, and its status, statistics, model and branch ancestry stay on the row. An input accepted into a queue retains its persisted input ID and queue state. Upon placement, it joins the active run as a steer or starts its own run. `replyId` records execution ownership and `parentId` records ancestry. Steer reserves no continuation row. Late evidence applies to its original run. A background wake that begins a new native execution after settlement receives a new run ID.

The timeline contains input references and output parts. An input item references its existing row. The part table from #24051 is the sole durable output body. Each new output part has one owner run and one position. Read adapters may assemble `parts[]` for history consumers such as export and model context. Rendering groups items independently of their durable ownership.

Root and child use the same contract. Each child archive has its own order and revision. Migration keeps existing message IDs, branch and fork anchors, attachment references, and saved part IDs. It identifies legacy run membership using existing reply and composition evidence; when evidence is incomplete, preserve the existing boundaries. Read an existing branch from its selected ancestry and preserve its recorded boundary. Preserve the original tool-result owner while resolving old archive references to part IDs.

#### Table relationships and fields

The following names use the TypeScript schema convention. **Existing** fields describe the current stack. **Required** fields are part of the Agent timeline cutover. **History** fields ship with incremental history reads.

```text
agent_session.id
  ├─ 1:N agent_session_context.sessionId
  └─ 1:N agent_session_message.sessionId
             user.replyId ──────────────► assistant.id (Run)
             user.inputContextId ───────► agent_session_context.id
             message.parentId ─────────► message.id (branch ancestry)

agent_session_message.id
  └─ 1:N agent_session_message_part.messageId
             agent_session_message_part.id
               └─ 1:0..1 agent_session_tool_output.partId (proposed)
```

| Table | Fields and phase | Meaning and write boundary |
| --- | --- | --- |
| `agent_session` | Existing: `id`, `ownerSessionId`, `activeNodeId` | `id` scopes one archive, including a separate archive for each child. `ownerSessionId` associates a child archive with its owning conversation. `activeNodeId` selects a node in the archive's message tree. |
| `agent_session` | Required: `lastPos`. History: `committedRev`, `resetVersion` | Main advances `lastPos` in the placement transaction. `committedRev` advances per committed history mutation and is shared by its changed rows. Deletion advances `resetVersion` in the same transaction so readers with old cursors reload. |
| `agent_session_context` | Existing: `id`, `sessionId`, `backendId`, `nativeThreadId`, `bindingState` | The context binds an archive to a native thread on a backend. The binding may be pending before the native thread is known. |
| `agent_session_context` | Existing: `parentContextId`, `spawnToolCallId`, `anchorMessageId`, `checkpointMapping` | Context ancestry and the spawn call identify a child; the anchor selects a product branch point. Recovery uses the existing checkpoint. |
| `agent_session_message` | Existing: `id`, `sessionId`, `role`, `parentId`, `replyId` | A user row is an input; an assistant row carries the Run. `parentId` forms the branch tree. User `replyId` points to an assistant row in the same archive and can be shared by a trigger and its steers. The existing link is mutable on regeneration. |
| `agent_session_message` | Existing: `inputContextId`, `nativeInputId`. Required: user `pos`. History: `rev` | Main binds a user row to a context before native submission; the native input ID completes the association. Only native placement assigns an input position. The history revision marks committed changes to an exposed input or Run. |
| `agent_session_message` | Existing: `status`, `modelId`, `stats`, `searchableText` | On assistant rows these carry execution state, model and usage, plus a derived search index value. Terminal settlement writes status and statistics. Content parts remain the source for searchable text. |
| `agent_session_message_part` | Existing: `id`, `messageId`, `sessionId`, `seq`, `type`, `payload` | `id` is the stable part ID. The foreign key `messageId` owns the part. For user content it points to the input row; for new assistant output it points to the Run row. `seq` orders the body within its owning row for input and legacy readers. `type` identifies the payload kind. |
| `agent_session_message_part` | Required for new Run output: `pos` and native source association. History: `rev` | Persist a placement record with the ID, owner, position and source at admission. The placement record has `payload = NULL` until the first body commit. History reads skip placement-only bodies. Recovery still reads their IDs and positions. User body parts use their owner's input position. Their individual `seq` values order components inside that input. |
| `agent_session_tool_output` | Existing key: `(messageId, toolCallId)`. Required key: `partId`, with existing `output` | `partId` is both the primary key and a foreign key to the tool part, with cascade on deletion. Completion or replacement atomically saves the part and its current result. The legacy key supplies the original association. Before enforcing the new key, verify on populated data that each readable old result has exactly one owning part. Unresolved results retain the old read path during migration. |

`inputContextId` records the native binding of an input, including one still queued. Main knows the live Run's executing context from native placement. Historical queries may derive it from an immutable, unambiguous triggering-input association. The existing reverse `replyId` lookup supplies neither uniqueness nor immutability. Leave attribution unknown where the evidence is incomplete. The Timeline cutover and fresh-context initialization require no assistant context column.

Main verifies same-archive ownership for the input-to-Run link, part owner and anchor. The input rows and output part rows share a single position allocator; their separate per-table indexes cannot enforce uniqueness across tables. For result lookup, the part determines its archive through its owner. A tool result change that is visible to history advances the owning part's revision in the same transaction.

### 2. Ordered items and durable commits

| Field | Assigned | Use |
| --- | --- | --- |
| `pos` | Once at input placement or first part admission | Timeline order within the archive |
| `rev` | Once per visible history transaction, shared by its changed rows | Committed history cursor |

One Main owner allocates positions for an archive. Keep the part ID and position together as placement metadata. Persist the placement record once at part admission, before publishing that identity. Thus recovery can restore the order even when the earlier open part had no committed body. Token append has no SQLite write. Completion writes the changed part and its associated tool result or file references atomically. Terminal and Stop write the remaining received parts and run status, retaining existing IDs and positions. Save success is published after commit. A failed save leaves readable live content for the existing retry or terminal path.

Timeline order is fixed at placement. An open part remains above a later steer while it grows, and new parts appear at their own positions. Legacy rows receive positions in their established display order using existing evidence. Reordering the selected branch or changing a mounted row group does not assign new positions.

### 3. Stable part identity and result ownership

Assign one part ID at first admission and retain it on subsequent live and persisted updates. The native key identifies the source block using its context, canonical native source and block key. Use a tool-call ID or explicit data ID when reported; a native index is valid only inside a source whose block ordering is stable. Use explicit adapter aliases for provisional-to-committed replacements. They must resolve to the admitted ID and position before accepting the replacement. For an unproven mapping, reconcile that source at the adapter boundary or request a new baseline. A product message index and a display group ID carry no storage identity.

The same part ID addresses the current tool result in Main, SQLite and renderer invalidation. Migrate the existing latest-only sidecar association from its original message and tool-call owner; payload stays in the existing sidecar. A pending lookup uses the accepted live result. After atomic handoff it uses the committed result. An output replacement invalidates only that part. New writes use stable source associations; legacy offset/count compositions remain readable for existing history and recovery.

#### Context binding and projection ownership

`agent_session_context` owns the native binding and native fork recovery. The Timeline owner maintains source-to-part associations, positions and removal state. New Timeline writes use those associations in place of the root array ranges and child composition. Read old `checkpointMapping.root` and `checkpointMapping.child` for legacy recovery. A fork publish owns only `checkpointMapping.fork` and preserves other recovery sections in the same transaction. The current [fork publish](../../../../src/main/data/services/AgentSessionContextService.ts) replaces the whole mapping, so this preservation needs a regression test.

New forks start only at supported boundaries after successfully completed Runs. A same-harness native fork requires a checkpoint for that exact boundary. Renderer offers Fork only at eligible boundaries, and Main rejects steer messages and positions inside a Run before preparing a fork.

An explicit native source replacement resolves its alias to the existing `partId` and position. A user deletion persists a suppression record for the canonical source in the deletion transaction, so replay cannot restore its content. Retain that record until the source can no longer be replayed. A history cursor reset refreshes the read view. Replay suppression separately protects the Timeline writer.

After the deletion commits, Main notifies the live Timeline owner of the affected part IDs. The owner releases their body references, accepted results and indexes, then publishes removal to subscribed renderers. The current projection [reads the context row](../../../../src/main/ai/agentSession/RootMessageProjection.ts) to apply removal and retains completed bodies for comparison. The Timeline cutover replaces that polling and body retention. Validate the removed references with heap retainers during Electron reproduction.

### 4. Incremental acceptance, publication and recovery

The Main timeline owner accepts normalized source changes. Its single application produces the changed item or text suffix and any durable work. Adapters that receive cumulative native messages reconcile the changed source and its reported changed blocks once at ingress. Neither the persistence writer nor the publisher rescans a reply to infer its changes.

For a pure text append, the native preview producer supplies the changed source block identity and the suffix before building any cumulative view. Main resolves that identity to a stable part ID. The live append handlers receive only the suffix and the affected part or its key. Build scoped snapshots for initialization, attachment or recovery. In `.oxlintrc.json`, apply `no-restricted-imports` overrides to the append producer and handlers. Reject imports of whole-view types, snapshot builders, history readers and whole-message diff code, including their re-exports.

```ts
type TimelineItem =
  | { kind: 'input'; inputId: InputId; runId: RunId; pos: Position }
  | { kind: 'part'; partId: PartId; runId: RunId; pos: Position; payload: CherryMessagePart }

type TimelineChange =
  | { type: 'insert'; item: TimelineItem }
  | { type: 'append'; partId: PartId; text: string }
  | { type: 'replace'; partId: PartId; payload: CherryMessagePart }
  | { type: 'remove'; itemId: InputId | PartId }
  | { type: 'settle'; runId: RunId; outcome: RunOutcome }
  | { type: 'result-changed'; partId: PartId }
```


The renderer applies one ordered batch before notifying subscribers by item or run ID. Only an affected part subscriber sees a text append. Inserts and removals also notify order consumers. Main coalesces pending operations by part for delivery without recomputing the current view. A complete, scoped baseline is used for attach or recovery. Live batches carry their own revision and publication identity; a gap, unknown target or stale publication triggers existing baseline recovery.

History reads take a consistent snapshot and its committed cursor. Subsequent reads return changed rows after that cursor and advance at a complete commit boundary. The cursor includes the view scope and an archive reset version. Deletion advances the reset version in the same transaction; a branch switch changes the view scope. A reader with an old cursor therefore gets a baseline even if it missed the invalidate notification.

Markdown stays inside a text part. Re-splitting can start from the last unstable block; constructs such as link reference definitions can invalidate earlier blocks. The performance proof for keyed delivery does not depend on changing Markdown parsing.

### 5. Initialize a fresh context from session messages

A harness change or an explicit request for a fresh context creates a new native thread in the target backend. Switching A → B → A creates A₁ → B₁ → A₂. A model change within a harness keeps its existing context. One session may retain several root contexts for its branch history.

1. **Choose the cutoff.** Main serializes the switch with input admission and branch changes. Begin at a settled point with no active Run, background work, unresolved approval or question, or unconsumed input in the old context. Capture the selected ancestry and its cutoff before the new input.
2. **Build bounded reference history.** Read `agent_session_message` and its parts on the selected ancestry through that cutoff, including settled rows produced in earlier native contexts. Share formatting with the existing [DeepSeek import](../../implemented/feature/2026-11-17-deepseek-agent-import.md) path. Admit only settled conversation content. Exclude reasoning and hidden data, represent completed tools as bounded excerpts, and retain necessary managed attachment references. Select entries within the target model's total reference budget and a byte budget before hydrating bodies. Prefer the last user message, last assistant message and first user message, then newest to oldest. Omit oversized results when a bounded excerpt is unavailable, and identify the omitted count and `pos` range. This read never loads the entire branch or full sidecar results to trim them afterward.
3. **Initialize once and commit the binding.** Pi Durable writes `cherry.reference-context` separately before the first submission. Pi and Claude Code prefix the reference to the first input. Main stages the input's target binding before submission so recovery can resolve native admission. Once initialization and the first input's admission are confirmed, publish the new root binding at the first input's branch anchor and retain the old anchors and checkpoint mappings. A failure before admission leaves the old binding active. When admission is uncertain, reconcile against the recorded input and target before retrying. Subsequent inputs to the new context use its native history.
4. **Release the old runtime.** After the binding commits, drain the admitted old-context updates, close its connection and drop its subscriptions and live projection references. Release only resources owned by that context. The switch retains the old native transcript and checkpoint mappings for resume, recovery and native fork or edit-and-resend on earlier branches. Preserve child ancestry and shared backends. Physical cleanup is a separate operation and requires backend support and proof that no retained context, task or checkpoint still uses the backend.

The reference supplies model context only. It adds no product transcript rows or restored native tool state, tasks or checkpoints. Each target is fresh, so initialization uses the binding and input identity without an `agent_session_context_transfer` table, Run coverage tracking or a new history copy in Cherry SQLite. At an eligible Run boundary, a same-harness fork uses its native checkpoint. A cross-harness fork initializes a fresh thread from the selected branch prefix through that boundary. New child tasks still receive their task prompt, and child forks stay within the parent's backend.

### 6. Owners and placement

| Location | Change |
| --- | --- |
| `AgentSessionRuntimeService` | Attach steers to the active Run, remove continuation reservation, coordinate context cutover and release |
| `RootMessageProjection`, `ChildThreadProjection` | Resolve native keys to stable parts and accept timeline changes |
| `AgentSessionMessageService` and schemas | Run and part storage, atomic completion and cursor reads |
| `AgentSessionContextService` | Multiple roots per session, native binding and branch anchors |
| `sessionHistory.ts` | Selected branch, cutoff, reference budget and exclusions |
| `MessageProjection` and renderer `aiTransport` | Part-addressed patches, scoped baselines and keyed subscriptions |
| Renderer list and Markdown | `pos` order, part keys and incremental block split |

### 7. Delivery order

1. This Spec at the stack bottom, with the runtime contract amendment.
2. Storage: use the part table of #24051, add stable placement and run ownership, and migrate the sidecar binding without rewriting shipped migrations.
3. Cut over the Agent timeline in one delivery: accept root and child operations, use completion persistence from #24100, migrate keyed publication and subscriptions, and remove the Agent whole-message hot path.
4. Validate the migrated consumers and measure Markdown separately.
5. Fresh-context initialization, binding and old-runtime release, with session runtime binding amended in its own branch.
6. Electron acceptance. Only this layer moves the note to implemented.

#23873 and #23909 keep their tool-result scope. Apply the new tool-part address to the Agent callers in the cutover. Message-list subscriptions is amended in its own layer to defer to this note for steer placement, part identity and the cursor.

#### Upgrading existing archives

1. **Establish the source body.** Upgrade from a supported schema through the existing migration chain. For inline `data.parts`, #24051's `0043_agent_session_message_part.sql` creates part rows in the original array order and removes the array in the same migration. For archives with part rows, reuse their IDs and payloads. Keep the original message IDs, timestamps and roles. Append a migration after every shipped migration.
2. **Backfill Run ownership and positions.** Keep every original message row used by ancestry, attachments or a native fork anchor. Use historical input placement, checkpoints and source membership as evidence when associating outputs with a Run. Ambiguous history keeps its existing boundaries. Allocate positions per archive in parent-before-child order, using the existing order for parts in each row and the saved fragment order for a verified child composition. Use `(createdAt, id)` to break ties between unrelated rows. A branch reader follows the preserved ancestry and branch boundary. Do not turn branch siblings into a single visible history.
3. **Translate native associations.** Resolve root offset/count ranges and child source and composition entries against the old part order before changing ownership. Store a native source association only if the old evidence identifies one part. Preserve fork checkpoints. Retain existing replay suppression where a legacy removal cannot be classified as a source alias or a user deletion. Keep the legacy recovery reader for those cases until they can be reconciled.
4. **Relink tool results by their original owner.** Match each old sidecar key with the tool part in the original archive row and verify that it is a unique match. Preserve the stored result or blob envelope as it is. Keep the old lookup available for unresolved rows and finish mapping them before enforcing the new primary key.
5. **Validate and switch.** Set each archive's position high-water mark to its highest assigned position and create an initial history cursor if available. Use the migration transaction for backfill and constraints. Enable the Timeline readers and writers after the required upgrade checks pass. The old compatibility readers resolve legacy references to the same stored bodies. A failed backfill rolls back. Validate attachment refs and search indexing using the existing seeder and FTS rules.

## Alternatives considered

- Run, attempt or turn tables, or one row per native assistant message: they duplicate an assistant row that already carries status, statistics and model, or multiply rows that item-level identity already correlates.
- Character cuts at steer time, segment rotation of an open part, or regrouping ongoing tools after the boundary: each adds cut or move state with reload obligations. Current T3 fixes positions at first write instead.
- The transport revision as the storage cursor, or T3's full event log: the transport revision is scoped to one publisher and subscription, and T3 compacts superseded events itself, so a row `rev` gives the same cursor without a log.
- Deriving public IDs from raw native message IDs: a provisional source can be replaced when it commits, so direct derivation can rekey a mounted part. Preserve the admitted ID and reconcile replacements at ingress.
- Converting product history into native Durable entries, or native-to-native converters: session messages already reach every harness through one builder.
- An LLM-written summary by default, as in [#24704](https://github.com/CherryHQ/cherry-studio/pull/24704): it costs a model call and varies in quality. It stays a compatible optional strategy.
- Reuse an earlier context and send a delta: it keeps that thread's native continuity, at the cost of tracking Run coverage and reconciling deliveries. The first version needs only fresh-context initialization.

## Acceptance criteria

- AC1 — A steer accepted during a run attaches to that run through `replyId`; no continuation row is created and the run settles once at its native terminal (verification: unit; Main runtime owner)
- AC2 — Inputs and parts render in `pos` order: parts created before a steer stay above it while streaming, later parts render below, and reload, a second window and reconnect reproduce that order (verification: unit and Electron; projection and renderer owners)
- AC3 — The same native block resolves to the same part ID after reconnect, snapshot replacement and restart on Claude Code, Pi and Pi Durable; new writes add no offset/count composition and legacy rows stay readable (verification: harness contract and setupTestDatabase unit; runtime owners)
- AC4 — Every committed row change raises `rev`; a reader at cursor N receives exactly the rows changed after N, and deletion or branch switching returns a fresh snapshot (verification: setupTestDatabase unit; Main data owner)
- AC5 — Appending to an open text part publishes one part-addressed append without other parts or the order, and only that part's subscribers re-render (verification: unit and renderer; transport and renderer owners)
- AC6 — While a part streams, Markdown re-splits only from its last unstable block and completed blocks keep their DOM (verification: renderer; Markdown owner)
- AC7 — Changing the model within one harness keeps the same context and native history (verification: unit regression; runtime owner)
- AC8 — A harness change or explicit context switch creates a fresh native thread. A → B → A creates three thread bindings, and each new thread receives the selected branch history through its cutoff before generating its first response (verification: unit; Main runtime owner)
- AC9 — Reference history fits the token and byte budgets, follows the stated priority, includes only settled visible conversation content and reports omissions. Building it does not hydrate oversized sidecar outputs (verification: storage and runtime unit; Main data and runtime owners)
- AC10 — Active Runs, background work and pending interactions or inputs block a switch. Before native admission, failure leaves the old binding usable. An interrupted admission is reconciled against its input identity without duplicate history or input submission (verification: unit with failure injection; Main data and runtime owners)
- AC11 — In Electron, a steer during streaming text and during a running tool keeps earlier parts mounted on Claude Code and Pi Durable, and a Claude Code to Pi Durable to Claude Code session answers with the reference history after each switch (verification: Electron; implementation owner)

- AC12 — A child reply spanning two native messages resolves the later large tool result by its part ID after attach, replacement and reload. An unrelated append or archive reread leaves that result's subscription unchanged (verification: Main and renderer integration; tool-result and child owners)
- AC13 — A crash after a committed steer, followed by replay of the preceding open part, preserves its original position and ID. Renderer offers no Fork on a steer message or inside a Run, and Main rejects those targets. A supported completed Run boundary still forks with its matching history (verification: populated SQLite, native replay and fork capability tests; storage, runtime and renderer owners)
- AC14 — With the active text part and suffix size fixed, growing settled history does not increase the number of messages or parts visited per pure append from native preview production through the renderer. The path builds no snapshot and performs no synchronous SQLite read or write. Oxlint rejects an append module's import of a bulk-view dependency while the recovery module can import it. Save, Stop and native terminal correction preserve committed part IDs (verification: local Oxlint and end-to-end integration with visit and query counts; runtime, storage and renderer owners)
- AC15 — Publishing a fork checkpoint preserves existing root and child recovery sections. A native alias replacement keeps the part ID and position. A committed user deletion stays deleted after replay through either alias and releases the affected live payload references (verification: SQLite and runtime regression tests; context and Timeline owners)
- AC16 — An upgrade from populated inline history and from populated part storage preserves selected branch and per-branch order, existing IDs, child archives, fork checkpoints, tool result ownership and attachment/search reads. Ambiguous source or result mapping preserves access. A failed backfill rolls back (verification: production migrations via setupTestDatabase; Main data and recovery owners)
- AC17 — After a successful switch, the old context releases its connection, subscriptions and projection references. Earlier branches retain readable history and their native fork checkpoints, and shared backends remain available to retained contexts (verification: runtime integration and Electron heap retainers; runtime and recovery owners)

## Risks

- Unfinished positions require durable placement before a later dependent commit. Measure the number of placement and completion transactions in long sessions.
- A part streaming above a steer pushes the steer down while it grows. This is the accepted T3 behavior; revisit it only with Electron evidence.
- Some adapters change native identifiers on commit. Require stable keys or proven aliases and exercise replay in each adapter.
- The budget can omit relevant history. A fresh context begins with the selected reference facts and its own execution state. The original thread remains the source for native recovery or checkpoint operations on the earlier branch.
- Existing user archives need populated upgrade tests before the storage cutover. Regenerate unpublished migration changes against the current parent and preserve the shipped chain.
- Several root contexts per session change recovery, fork and deletion paths that assume one binding.
