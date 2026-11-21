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

This note specializes the [runtime contract](2026-10-17-agent-runtime-contract.md). It partially supersedes the steer, part identity and cursor sections of [message-list subscriptions](https://github.com/CherryHQ/cherry-studio/blob/f65c54cd6069caf5b1efa3c99ea1fe08ce543645/.agents/notes/proposed/architecture/2026-11-09-message-list-subscriptions.md), the renderer cut model of [native steer](https://github.com/CherryHQ/cherry-studio/blob/ab83909a7c637c81c6d59221f76d1aad919d2add/.agents/notes/proposed/bug-fix/2026-11-09-agent-native-steer.md), and the immutability rule of session runtime binding. [Tool result boundaries](2026-11-09-tool-result-projection-boundaries.md) is unchanged: its publication revision stays a delivery sequence, separate from the storage cursor below.

## Proposal

### 1. Run owns execution and Timeline owns content

A run begins when the harness places its triggering input and settles at its native terminal. The existing assistant row is its physical record. Its ID is the run ID, and its context, status, statistics, model and branch ancestry stay on the row. An input accepted into a queue retains its persisted input ID and queue state. Upon placement, it joins the active run as a steer or starts its own run. `replyId` records execution ownership and `parentId` records ancestry. Steer reserves no continuation row. Late evidence applies to its original run. A background wake that begins a new native execution after settlement receives a new run ID.

The timeline contains input references and output parts. An input item references its existing row. The part table from #24051 is the sole durable output body. Each new output part has one owner run and one position. Read adapters may assemble `parts[]` for history consumers such as export and model context. Rendering groups items independently of their durable ownership.

Root and child use the same contract. Each child archive has its own order and revision. Migration keeps existing message IDs, branch and fork anchors, attachment references, and saved part IDs. It identifies legacy run membership using existing reply and composition evidence; when evidence is incomplete, preserve the existing boundaries. A branch or fork inside a run reads the selected ancestry and its item cutoff, including only the shared prefix of the run. Preserve the original tool-result owner while resolving old archive references to part IDs.

### 2. Ordered items and durable commits

| Field | Assigned | Use |
| --- | --- | --- |
| `pos` | Once at input placement or first part admission | Timeline order within the archive |
| `rev` | Once per write transaction, shared by its changed rows | Committed history cursor |

One Main owner allocates positions for an archive. Keep the part ID and position together as placement metadata. Persist this metadata once when a part is admitted or in the transaction that first commits a later dependent item, such as a steer. Thus recovery can restore the order even when the earlier open part had no committed body. Token append has no SQLite write. Completion writes the changed part and its associated tool result or file references atomically. Terminal and Stop write the remaining received parts and run status, retaining existing IDs and positions. Save success is published after commit. A failed save leaves readable live content for the existing retry or terminal path.

Timeline order is fixed at placement. An open part remains above a later steer while it grows, and new parts appear at their own positions. Legacy rows receive positions in their established display order using existing evidence. Reordering the selected branch or changing a mounted row group does not assign new positions.

### 3. Stable part identity and result ownership

Assign one part ID at first admission and retain it on subsequent live and persisted updates. The native key identifies the source block using its context, canonical native source and block key. Use a tool-call ID or explicit data ID when reported; a native index is valid only inside a source whose block ordering is stable. Use explicit adapter aliases for provisional-to-committed replacements. They must resolve to the admitted ID and position before accepting the replacement. For an unproven mapping, reconcile that source at the adapter boundary or request a new baseline. A product message index and a display group ID carry no storage identity.

The same part ID addresses the current tool result in Main, SQLite and renderer invalidation. Migrate the existing latest-only sidecar association from its original message and tool-call owner; payload stays in the existing sidecar. A pending lookup uses the accepted live result. After atomic handoff it uses the committed result. An output replacement invalidates only that part. New writes use stable source associations; legacy offset/count compositions remain readable for existing history and recovery.

### 4. Incremental acceptance, publication and recovery

The Main timeline owner accepts normalized source changes. Its single application produces the changed item or text suffix and any durable work. Adapters that receive cumulative native messages reconcile the changed source and its reported changed blocks once at ingress. Neither the persistence writer nor the publisher rescans a reply to infer its changes.


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

### 5. Context transfer through session messages

A session may own several root contexts over time, one per native thread. A context's coverage is the runs whose `context_id` names it, plus transfers delivered into it.

- A model change within a harness keeps the context. Native history and pi-ai adaptation are unchanged.
- A harness change, or an explicit fresh context, opens a context in the target backend. Its first run receives portable history built from session messages, the hub DeepSeek import already uses. Returning to an earlier context delivers only the runs it did not cover.

`readSessionHistory` becomes that builder:

- First-input initialization runs only before the target has model input. A return transfer runs whenever that target has uncovered runs, including after it already has input. [DeepSeek import](../../implemented/feature/2026-11-17-deepseek-agent-import.md) documents the current first-input path.
- It covers the target's uncovered range, or the whole selected path for a new context.
- It fits a total budget derived from the target model's context window. It keeps whole messages in [T3's priority](https://github.com/pingdotgg/t3code/blob/13aa882c22d584de5388dfce3b3ca413387ba059/packages/provider-core/src/server/handoffBudget.ts): the last user message, the last assistant message, the first user message, then newest to oldest. The preamble states the omitted count and `pos` range.
- It excludes reasoning and hidden data parts. Tool calls keep their input and head/tail output.
- Each driver keeps its delivery: Durable writes its `cherry.reference-context` entry, and Pi and Claude Code prefix the first message.

A new `agent_session_context_transfer` record stores `kind` (`handoff` or `fork`), source session, target context, target run, `resolution` (`native` or `history`), covered `pos` range, omitted IDs, delivery state (`pending`, `delivered` or `failed`) and creation time. The payload is regenerated from rows, not stored. Main writes `pending` before delivery and `delivered` after native admission. When delivery cannot be confirmed after a restart, Main opens a fresh target context rather than risk duplicated history, as [T3's delivery](https://github.com/pingdotgg/t3code/blob/13aa882c22d584de5388dfce3b3ca413387ba059/apps/server/src/orchestration-v2/ContextHandoffDelivery.ts) does. Same-harness forks resolve natively; a cross-harness fork uses `history`.

Children are unchanged: a fresh child receives only its task prompt, and a fork child forks natively in the parent's backend. A cross-harness child would add a transfer kind later.

### 6. Owners and placement

| Location | Change |
| --- | --- |
| `AgentSessionRuntimeService` | Attach steers to the active run, remove continuation reservation, orchestrate transfers |
| `RootMessageProjection`, `ChildThreadProjection` | Resolve native keys to stable parts and accept timeline changes |
| `AgentSessionMessageService` and schemas | Run and part storage, atomic completion and cursor reads |
| `AgentSessionContextService` | Several root contexts per session and transfer records |
| `sessionHistory.ts` | Gate, range, budget and exclusions |
| `MessageProjection` and renderer `aiTransport` | Part-addressed patches, scoped baselines and keyed subscriptions |
| Renderer list and Markdown | `pos` order, part keys and incremental block split |

### 7. Delivery order

1. This Spec at the stack bottom, with the runtime contract amendment.
2. Storage: use the part table of #24051, add stable placement and run ownership, and migrate the sidecar binding without rewriting shipped migrations.
3. Cut over the Agent timeline in one delivery: accept root and child operations, use completion persistence from #24100, migrate keyed publication and subscriptions, and remove the Agent whole-message hot path.
4. Validate the migrated consumers and measure Markdown separately.
5. Context transfer and multiple root contexts, with session runtime binding amended in its own branch.
6. Electron acceptance. Only this layer moves the note to implemented.

#23873 and #23909 keep their tool-result scope. Apply the new tool-part address to the Agent callers in the cutover. Message-list subscriptions is amended in its own layer to defer to this note for steer placement, part identity and the cursor.

## Alternatives considered

- Run, attempt or turn tables, or one row per native assistant message: they duplicate an assistant row that already carries status, statistics and model, or multiply rows that item-level identity already correlates.
- Character cuts at steer time, segment rotation of an open part, or regrouping ongoing tools after the boundary: each adds cut or move state with reload obligations. Current T3 fixes positions at first write instead.
- The transport revision as the storage cursor, or T3's full event log: the transport revision is scoped to one publisher and subscription, and T3 compacts superseded events itself, so a row `rev` gives the same cursor without a log.
- Deriving public IDs from raw native message IDs: a provisional source can be replaced when it commits, so direct derivation can rekey a mounted part. Preserve the admitted ID and reconcile replacements at ingress.
- Converting product history into native Durable entries, or native-to-native converters: session messages already reach every harness through one builder.
- An LLM-written summary by default, as in [#24704](https://github.com/CherryHQ/cherry-studio/pull/24704): it costs a model call and varies in quality. It stays a compatible optional strategy.
- Always opening a fresh context when returning to a harness: it discards the native continuity a delta transfer keeps.

## Acceptance criteria

- AC1 — A steer accepted during a run attaches to that run through `replyId`; no continuation row is created and the run settles once at its native terminal (verification: unit; Main runtime owner)
- AC2 — Inputs and parts render in `pos` order: parts created before a steer stay above it while streaming, later parts render below, and reload, a second window and reconnect reproduce that order (verification: unit and Electron; projection and renderer owners)
- AC3 — The same native block resolves to the same part ID after reconnect, snapshot replacement and restart on Claude Code, Pi and Pi Durable; new writes add no offset/count composition and legacy rows stay readable (verification: harness contract and setupTestDatabase unit; runtime owners)
- AC4 — Every committed row change raises `rev`; a reader at cursor N receives exactly the rows changed after N, and deletion or branch switching returns a fresh snapshot (verification: setupTestDatabase unit; Main data owner)
- AC5 — Appending to an open text part publishes one part-addressed append without other parts or the order, and only that part's subscribers re-render (verification: unit and renderer; transport and renderer owners)
- AC6 — While a part streams, Markdown re-splits only from its last unstable block and completed blocks keep their DOM (verification: renderer; Markdown owner)
- AC7 — Changing the model within one harness keeps the same context and native history (verification: unit regression; runtime owner)
- AC8 — Changing harness opens a context whose first run receives session-message history through the existing driver delivery, and returning to an earlier context delivers only the runs it did not cover (verification: unit; Main runtime owner)
- AC9 — Portable history stays within the target budget, keeps whole messages in the stated priority, excludes reasoning and hidden data parts, and states the omitted count and range (verification: unit; Main runtime owner)
- AC10 — Every transfer records its covered range and delivery state, and an interrupted delivery never sends duplicated history into one context (verification: unit with failure injection; Main data and runtime owners)
- AC11 — In Electron, a steer during streaming text and during a running tool keeps earlier parts mounted on Claude Code and Pi Durable, and a Claude Code to Pi Durable to Claude Code session answers with the transferred context (verification: Electron; implementation owner)

- AC12 — A child reply spanning two native messages resolves the later large tool result by its part ID after attach, replacement and reload. An unrelated append or archive reread leaves that result's subscription unchanged (verification: Main and renderer integration; tool-result and child owners)
- AC13 — A crash after a committed steer, followed by replay of the preceding open part, preserves its original position and ID. A fork inside a run does not expose items beyond the fork point (verification: populated SQLite and native replay tests; storage and runtime owners)
- AC14 — A pure append visits only the affected source block and performs no synchronous SQLite read or write. A save, Stop, or native terminal correction preserves IDs of already committed parts (verification: runtime integration with query and notification counts; runtime and storage owners)

## Risks

- Unfinished positions require durable placement before a later dependent commit. Measure the number of placement and completion transactions in long sessions.
- A part streaming above a steer pushes the steer down while it grows. This is the accepted T3 behavior; revisit it only with Electron evidence.
- Some adapters change native identifiers on commit. Require stable keys or proven aliases and exercise replay in each adapter.
- The budget can omit relevant history. No history-read tool is part of this Spec, and portable history is reference text: historical tool calls are not restored as native tool state.
- The migrations of #24051 and #24100 must be regenerated on this base and migrate populated databases.
- Several root contexts per session change recovery, fork and deletion paths that assume one binding.
