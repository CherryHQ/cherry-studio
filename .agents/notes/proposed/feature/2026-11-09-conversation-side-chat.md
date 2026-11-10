# Agent Note: Conversation side chat with optional persistence

Status: proposed

English | [中文](2026-11-09-conversation-side-chat.zh.md)

## Problem

[Issue #21973](https://github.com/CherryHQ/cherry-studio/issues/21973) asks for brief follow-up questions beside a long answer. Asking in the main composer interrupts reading and inherits the main conversation's expansive prompt. Copying into another app loses context.

The side panel supports selection-based questions in ordinary chat and Agent sessions. It follows the current main conversation model and reuses the shared message list and composer. It has no settings or whole-answer, question-count, or top-right entry points. Existing history and persistence rules remain unchanged. This Spec defines target behavior; it does not implement or release it.

## Proposal

### Scope and interaction

Use an independent side chat linked to one source answer. Support ordinary chat and Agent sessions. Nested side chats, merging into the main conversation, multiple source answers, and side-chat export are out of scope. Codex is an interaction reference only; no claim is made about its internals.

Select answer text and choose the side-chat action. This is the only opening entry point. Reject empty, cross-message, or unverifiable selections instead of quoting the whole answer. Each invocation can create a new side chat; the opened panel also lists retained chats for that source. Source markers only identify verified excerpts and never open a panel. The header shows the source excerpt and persistence state. Preserve the main reading position and active branch when opening, collapsing, or switching the panel.

The side chat has no model, prompt, or saving controls. Keep the existing brief explanation prompt. Ordinary chat passes the current composer's uniquely resolved model on creation, submit, and retry; multiple selected models require a single selection in the main composer. Agent sources use `agent-session:<sessionId>`; Main validates the real session, message ownership and ancestor branch and resolves the owning Agent's current model at request admission. The next submit or retry follows a changed main model; in-flight requests retain their captured model. Missing or invalid models use the existing model error without clearing drafts/history or falling back to a saved model. Reuse `MessageList` and `ComposerSurface`, with window-memory side-chat drafts and no tools, settings, or recursive side-chat capability.

### Context contract

| Request | Included context |
|---|---|
| First side question | Selected text, the containing answer, the user question that produced it, and the current question |
| Later side question | The original source snapshot plus this side chat's history and current question |
| Main chat request | Its existing main context; no side-chat messages |

Do not append later main-chat messages to an existing side chat. Capture the source once; later edits do not rewrite the snapshot. Treat source material as quoted data, never as system instructions. When context exceeds the model limit, prioritize the selection and current question and disclose omitted context. If those alone cannot fit, reject the request with an actionable explanation instead of silently truncating them.

### Persistence and lifecycle

Keep the existing `chat.side_chat.save_history` preference and its enabled default. Read it when creating a side chat and retain the chosen mode for its lifetime. Remove the settings UI without deleting the preference or converting or deleting existing history.

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

### Anchors, counts, and deletion

Store message identity, selected text, and surrounding text hints; never DOM nodes or screen coordinates. After source edits or regeneration, keep the snapshot. When unique matching fails, do not mark an unverified excerpt; retain the captured snapshot in the panel. Never guess among repeated excerpts.

If only the source answer is deleted, keep the side-chat snapshot accessible from the source topic's side-chat list. Soft deletion/restoration of the main topic hides/restores associated side chats. Permanent topic deletion clears saved and temporary associations through the existing deletion confirmation flow. Apply the same lifecycle rules to Agent session and Agent deletion, restoration, and permanent cleanup.

Do not display question-count entry points beneath answers or in the flow view. Internally derive each answer's count from submitted user questions across its associated side chats. Two questions count as two. Retrying an answer adds nothing; deleting a question subtracts one. A submitted question counts even if generation fails. Live temporary questions count until cleared. Do not maintain a second independent persisted counter.

## Alternatives considered

- Temporary-only panel: smaller persistence scope, but cannot reopen saved follow-ups. Retain existing temporary records and their lifecycle without exposing a setting.
- Special branch inside the original message tree: reuses tree operations but couples side questions to main branch selection and context. Independent topics make isolation explicit; accept the cost of association/filtering/deletion integration.
- Separate app or main composer: no new side-panel implementation, but preserves the reading interruption or manual context-copying problem.

## Acceptance criteria

- AC1 — Only verified answer selections in ordinary chat and Agent sessions open a side chat without moving the main reading position or changing its active branch. (verification: Electron)
- AC2 — Captured requests contain only the defined source snapshot and current side history; later main messages and other side chats do not leak into requests. Oversize context is disclosed or rejected as specified. (verification: unit)
- AC3 — Main and side chat generate concurrently; stopping either does not stop the other, and closing a temporary chat rejects late stream updates. (verification: unit and Electron)
- AC4 — Submit and retry follow the current main model, including after a model switch; in-flight requests do not change. Invalid models preserve history and drafts. The shared list/composer render side chats without settings or recursive entries. (verification: renderer and Electron)
- AC5 — Two submitted questions count as two, retry stays at two, deletion reduces the count, failed generation still counts, and clearing temporary chats removes their contribution. (verification: unit and renderer)
- AC6 — Saved history, model/prompt, source snapshot, and markers restore after restart. (verification: Electron)
- AC7 — Temporary content clears on explicit close or window close and leaves no matching body in the database, persistent caches, backup, or application logs/traces. (verification: unit and Electron)
- AC8 — No side-chat settings are exposed. The existing enabled default affects only creation; existing saved and temporary chats keep their original mode and history. (verification: unit and renderer)
- AC9 — Switching topics or preview panels retains drafts and generation state under the correct side-chat identity. (verification: renderer and Electron)
- AC10 — Source markers are non-interactive. Edited, regenerated, repeated, or deleted text never marks an unverified location; retained snapshots remain accessible in the panel after opening it through a valid selection. (verification: unit and Electron)
- AC11 — Main-topic and Agent-source soft deletion, restoration, and permanent deletion update saved and temporary associations consistently; ordinary topic lists and main export exclude side chats. (verification: unit and Electron)
- AC12 — Backup/restore preserves saved side chats and their source links and omits temporary chats. (verification: unit and Electron)

## Risks

Persistent-topic coupling may enlarge the generation change. Topic filters and deletion/backup consumers can omit associations. Persisted tracing may defeat temporary mode. Rendered text may not map uniquely to source text. These risks must not weaken the behavior defined above.
