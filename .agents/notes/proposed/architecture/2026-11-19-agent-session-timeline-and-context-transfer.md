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

### 1. A run is the assistant row; steers join it

An assistant row records one run: one agent-loop execution from its triggering input to its native terminal. Steer inputs accepted while it runs attach to it through the existing `replyId`. Main no longer reserves a continuation row at native placement, and the run settles once. Queued and follow-up inputs start their own runs.

The run row adds `context_id`, the context that executed it, beside its existing status, statistics and `modelId`. No run, attempt or turn table is added.

### 2. Ordered items: one counter, `pos` and `rev`

Each session keeps one monotonic counter. Every message and part row stores two values from it:

| Field | Assigned | Use |
| --- | --- | --- |
| `pos` | Once, when Main accepts the input or first creates the part | Timeline order; never changes |
| `rev` | On every committed change of the row | Change cursor |

Main allocates `pos` with a synchronous counter increment, even when the part row is written later at part completion, so a crash may leave gaps. Counter writes do not touch `updatedAt` or `lastActivityAt`. Each child archive keeps its own counter.

The timeline orders inputs and parts by `pos`, following [T3's position rule](https://github.com/pingdotgg/t3code/blob/13aa882c22d584de5388dfce3b3ca413387ba059/apps/server/src/orchestration-v2/TurnItemPositionStore.ts): parts created before a steer stay above it, including one still streaming, and parts created after render below. Nothing is cut by characters, rotated into a new segment or regrouped. A reasoning part still open when later items arrive renders as settled. Legacy rows receive `pos` once, in their existing `(createdAt, id)` order and stored part order.

### 3. Part identity from native identity

A part ID is derived from its context, native message ID and block key: the `toolCallId`, a data part ID, or the block's position within that native message. `native_ref` stores the native message ID and block key for fork points and diagnostics. The product array index never feeds the derivation.

The same native block therefore resolves to the same part after reconnect, snapshot replacement and restart without a stored mapping. New writes stop adding `checkpointMapping.root` and `child.composition` entries; legacy offset/count mappings stay readable without backfill. A harness that cannot report stable native message identity and block order fixes its adapter.

### 4. Change cursor and incremental delivery

History reads take a snapshot at `rev` N, then read only rows whose `rev` exceeds N. Deletions and branch switches return a fresh snapshot instead of tombstones.

The live projection keeps its publication revision for duplicate and gap detection, as the tool-result note requires, but addresses changes by part ID: insert at `pos`, append a delta to an open text or reasoning part, replace a part, or remove one. Appending text sends neither unrelated parts nor the full order. The renderer keys and subscribes by part ID, per the keyed subscriptions of message-list subscriptions.

Markdown keeps Streamdown and its memoized blocks. Each part caches its block split and, on append, re-splits from the start of its last unstable block. A construct that moves the unstable start backward, such as a link reference definition, re-splits that part.

### 5. Context transfer through session messages

A session may own several root contexts over time, one per native thread. A context's coverage is the runs whose `context_id` names it, plus transfers delivered into it.

- A model change within a harness keeps the context. Native history and pi-ai adaptation are unchanged.
- A harness change, or an explicit fresh context, opens a context in the target backend. Its first run receives portable history built from session messages, the hub DeepSeek import already uses. Returning to an earlier context delivers only the runs it did not cover.

`readSessionHistory` becomes that builder:

- It skips only when the target context already has model input. Native identity elsewhere in the prefix no longer disables it.
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
| `RootMessageProjection`, `ChildThreadProjection` | Derive part IDs, allocate `pos`, stop composition writes |
| `AgentSessionMessageService` and schemas | Counter, `pos` and `rev`, change reads, session-scoped part position |
| `AgentSessionContextService` | Several root contexts per session and transfer records |
| `sessionHistory.ts` | Gate, range, budget and exclusions |
| `MessageProjection` and renderer `aiTransport` | Part-addressed patches |
| Renderer list and Markdown | `pos` order, part keys and incremental block split |

### 7. Delivery order

1. This Spec at the stack bottom, with the runtime contract amendment.
2. Storage: counter, `pos`, `rev`, derived IDs and `context_id` on the part table of #24051 and #24100, with regenerated migrations.
3. Runs and steer: attach steers, remove the continuation row and render by `pos`.
4. Incremental delivery and Markdown.
5. Context transfer and multiple root contexts, with session runtime binding amended in its own branch.
6. Electron acceptance. Only this layer moves the note to implemented.

#23873 and #23909 keep their tool-result scope. Message-list subscriptions is amended in its own layer to defer to this note for steer placement, part identity and the cursor.

## Alternatives considered

- Run, attempt or turn tables, or one row per native assistant message: they duplicate an assistant row that already carries status, statistics and model, or multiply rows that item-level identity already correlates.
- Character cuts at steer time, segment rotation of an open part, or regrouping ongoing tools after the boundary: each adds cut or move state with reload obligations. Current T3 fixes positions at first write instead.
- The transport revision as the storage cursor, or T3's full event log: the transport revision is scoped to one publisher and subscription, and T3 compacts superseded events itself, so a row `rev` gives the same cursor without a log.
- Allocating part IDs once and persisting a source mapping: derivation removes the mapping storage and its recovery.
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

## Risks

- Counter writes add one small synchronous write per accepted input, created part and committed change. Measure write volume on long sessions.
- A part streaming above a steer pushes the steer down while it grows. This is the accepted T3 behavior; revisit it only with Electron evidence.
- Derived identity depends on stable native message IDs and block order in every adapter.
- The budget can omit relevant history. No history-read tool is part of this Spec, and portable history is reference text: historical tool calls are not restored as native tool state.
- The migrations of #24051 and #24100 must be regenerated on this base and migrate populated databases.
- Several root contexts per session change recovery, fork and deletion paths that assume one binding.
