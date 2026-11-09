# Agent Note: Conversation side chat with optional persistence

Status: proposed

English | [中文](2026-11-09-conversation-side-chat.zh.md)

## Problem

[Issue #21973](https://github.com/CherryHQ/cherry-studio/issues/21973) asks for brief follow-up questions beside a long answer. Asking in the main composer interrupts reading and inherits the main conversation's expansive prompt. Copying into another app loses context.

The side panel needs its own model and prompt, selection-based questions, source markers, and question counts in the flow view. The additional product requirement is a setting that chooses whether new side chats are saved. This Spec defines target behavior; it does not implement or release it.

## Proposal

### Scope and interaction

Use an independent side chat linked to one source answer. Initially support ordinary chat only. Agent sessions, nested side chats, merging into the main conversation, multiple source answers, and side-chat export are out of scope. Codex is an interaction reference only; no claim is made about its internals.

Select answer text and choose the side-chat action, or use the answer menu to ask about the whole answer. Each invocation creates a new side chat. Clicking an existing marker continues its chat. The header shows the source excerpt, model, and persistence state. A topic-level side-chat list provides access when a source marker is unavailable. Preserve the main reading position and active branch when opening, collapsing, or switching the panel.

The side chat has an independent model and editable prompt. Default to a brief explanation of the quoted material. Model and prompt changes apply to the next request and never change the main chat's settings. Invalid models/providers require reselection without discarding history.

### Context contract

| Request | Included context |
|---|---|
| First side question | Selected text, the containing answer, the user question that produced it, and the current question |
| Later side question | The original source snapshot plus this side chat's history and current question |
| Main chat request | Its existing main context; no side-chat messages |

Do not append later main-chat messages to an existing side chat. Capture the source once; later edits do not rewrite the snapshot. Treat source material as quoted data, never as system instructions. When context exceeds the model limit, prioritize the selection and current question and disclose omitted context. If those alone cannot fit, reject the request with an actionable explanation instead of silently truncating them.

### Persistence and lifecycle

Add **Save side-chat history by default** through Preference, enabled by default. Read the setting when a side chat is created and retain that choice for its lifetime. Changing the global default affects only new side chats; it never deletes or converts existing history.

| Action | Saved side chat | Temporary side chat |
|---|---|---|
| Collapse panel or switch to file preview | Retain | Retain in memory |
| Explicitly close this side chat | Stop generation; retain history | Stop generation; clear messages, drafts, and markers |
| Switch main topic | Retain under its source topic | Retain in the current window; return to continue |
| Close window or restart | Restore history and configuration | Clear; do not restore |
| Change the global default | Keep existing mode | Keep existing mode |
| Delete the side chat | Delete history and markers | Clear memory and markers |

Distinguish collapse from closing a temporary side chat. The close action must state that contents are cleared. Cancellation must invalidate late stream callbacks so cleared content cannot reappear.

Temporary content must not enter the chat database, persistent caches, backup, or application logs/traces. Audit request tracing before reusing generation. Do not create a database topic and delete it afterward. Content is still sent to the selected model provider; this mode makes no promise about provider retention. Saved side chats and source associations participate in backup/restore. Main-chat export excludes side-chat messages in the first release.

### Ownership and implementation boundaries

Source paths checked against main `ec5e904b21`:

| Owner | Integration point and responsibility |
|---|---|
| Pixel: panel and selection | `src/renderer/components/chat/shell/ConversationShell.tsx`, `src/renderer/components/chat/panes/Shell/RightPanel.tsx`; reuse panel identity, width, and switching. Wire selection and whole-answer actions to the source identity. |
| Pixel: source navigation | `src/renderer/components/chat/flow/TopicMessageFlowNode.tsx`; render question counts, markers, and the side-chat list. |
| Lin: storage | `src/main/data/db/schemas/message.ts` enforces one live root per topic. Use independent saved topics with explicit source association; exclude them from ordinary topic lists and main context. |
| Lin: generation and settings | Reuse the existing request, streaming, cancellation, and Preference mechanisms. Isolate request identities and provide memory-only temporary state. |
| Ada: contract; Rigel: verification | Resolve boundary changes before implementation; verify each acceptance criterion and report platform gaps. |

Required information is the side-chat identity, source topic/message identity, excerpt and anchor hints, immutable source snapshot, persistence choice, model, and prompt. Evaluate existing metadata first. Add only the minimum association/schema changes if needed. Any schema change uses an appended migration, never a rewritten shipped migration.

The persistent-topic dependency of generation is still an implementation investigation, not a verified capability. First trace request creation, persistence, logging, cancellation, deletion, backup, and topic-list consumers. If memory-only execution requires changes, isolate the smallest shared generation boundary. Do not build a second model stack or relax temporary-mode guarantees. Material contract changes return to this Spec before code proceeds.

### Anchors, counts, and deletion

Store message identity, selected text, and surrounding text hints; never DOM nodes or screen coordinates. After source edits or regeneration, keep the snapshot. When unique matching fails, use a message-level marker and state that precise location is unavailable. Never guess among repeated excerpts.

If only the source answer is deleted, keep the side-chat snapshot accessible from the source topic's side-chat list. Soft deletion/restoration of the main topic hides/restores associated side chats. Permanent topic deletion clears saved and temporary associations through the existing deletion confirmation flow.

Derive each answer's count from submitted user questions across its associated side chats. Two questions count as two. Retrying an answer adds nothing; deleting a question subtracts one. A submitted question counts even if generation fails. Live temporary questions count until cleared. Do not maintain a second independent persisted counter.

### Delivery sequence

| Stage | Owner | Exit condition |
|---|---|---|
| 1. Resolve boundaries | Ada and Lin | Confirm source associations, topic filtering, and a memory-only generation path; record any required Spec adjustment. |
| 2. Working side chat | Lin and Pixel | Both entry points, isolated context, independent configuration, streaming, and cancellation work. |
| 3. Complete lifecycle | Lin and Pixel | Default setting, persistence, restoration, markers, counts, deletion, and backup association work together. |
| 4. Acceptance | Rigel; Ada closes verification | Focused checks and actual UI/restart evidence cover the ACs; unverified platforms remain explicit. |

Stage 2 is a trial milestone, not completion. Keep this note proposed until all criteria are implemented and verified. This documentation PR does not close the feature issue. Implementation PRs reference this Spec and their covered AC IDs. Estimate work after stage 1 establishes the generation changes.

## Alternatives considered

- Temporary-only panel: smaller persistence scope, but cannot reopen saved follow-ups. Retain temporary behavior as a setting instead.
- Special branch inside the original message tree: reuses tree operations but couples side questions to main branch selection and context. Independent topics make isolation explicit; accept the cost of association/filtering/deletion integration.
- Separate app or main composer: no new side-panel implementation, but preserves the reading interruption or manual context-copying problem.

## Acceptance criteria

- AC1 — Selection and whole-answer actions open a side chat without moving the main reading position or changing its active branch. (verification: Electron; owner: Pixel and Rigel)
- AC2 — Captured requests contain only the defined source snapshot and current side history; later main messages and other side chats do not leak into requests. Oversize context is disclosed or rejected as specified. (verification: unit; owner: Lin and Rigel)
- AC3 — Main and side chat generate concurrently; stopping either does not stop the other, and closing a temporary chat rejects late stream updates. (verification: unit and Electron; owner: Lin and Rigel)
- AC4 — Side-chat model and prompt changes affect only subsequent side requests; invalid provider/model choices preserve history and request reselection. (verification: renderer and Electron; owner: Pixel and Rigel)
- AC5 — Two submitted questions count as two, retry stays at two, deletion reduces the count, failed generation still counts, and clearing temporary chats removes their contribution. (verification: unit and renderer; owner: Lin, Pixel, and Rigel)
- AC6 — Saved history, model/prompt, source snapshot, and markers restore after restart. (verification: Electron; owner: Lin and Rigel)
- AC7 — Temporary content clears on explicit close or window close and leaves no matching body in the database, persistent caches, backup, or application logs/traces. (verification: unit and Electron; owner: Lin and Rigel)
- AC8 — The default setting starts enabled and affects only newly created chats; existing saved and temporary chats keep their original mode. (verification: unit and renderer; owner: Lin and Rigel)
- AC9 — Switching topics or preview panels retains drafts and generation state under the correct side-chat identity. (verification: renderer and Electron; owner: Pixel and Rigel)
- AC10 — Edited, regenerated, repeated, or deleted source text never sends navigation to an unverified location; retained snapshots remain accessible from the topic list. (verification: unit and Electron; owner: Pixel and Rigel)
- AC11 — Main-topic soft deletion, restoration, and permanent deletion update saved and temporary associations consistently; ordinary topic lists and main export exclude side chats. (verification: unit and Electron; owner: Lin and Rigel)
- AC12 — Backup/restore preserves saved side chats and their source links and omits temporary chats. (verification: unit and Electron; owner: Lin and Rigel)

Use focused tests for isolation, lifecycle, and anchor ambiguity. Run affected type/lint/format checks; keep total local test memory below 2 GB. Skip the system speech component build on the local Windows machine lacking ATL. Report actual platform/runtime evidence separately; document checks do not satisfy product ACs.

## Risks

Persistent-topic coupling may enlarge the generation change. Topic filters and deletion/backup consumers can omit associations. Persisted tracing may defeat temporary mode. Rendered text may not map uniquely to source text. These are stage-1 inspection targets and acceptance boundaries, not reasons to silently weaken the contract.
