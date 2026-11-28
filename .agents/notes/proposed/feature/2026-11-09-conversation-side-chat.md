# Agent Note: Conversation side chat with optional persistence

Status: proposed

English | [中文](2026-11-09-conversation-side-chat.zh.md)

## Problem

[Issue #21973](https://github.com/CherryHQ/cherry-studio/issues/21973) asks for brief follow-up questions beside a long answer. Asking in the main composer interrupts reading and inherits the main conversation's expansive prompt. Copying into another app loses context.

The side panel supports selection-based questions in ordinary chat and Agent sessions. It follows the current main conversation model and reuses the shared message list and composer. It has no settings or whole-answer, question-count, or top-right entry points. Existing history and persistence rules remain unchanged. This Spec defines target behavior; it does not implement or release it.

## Proposal

### Scope and interaction

Use an independent side chat linked to one source answer. Support ordinary chat and Agent sessions. Nested side chats, merging into the main conversation, multiple source answers, and side-chat export are out of scope. Codex is an interaction reference only; no claim is made about its internals.

Select text within one answer and use the same selection bubble as Copy and Quote. Accept rendered text across formatting, tables and blocks even when it is not a literal Markdown substring. Reject empty or cross-message selections and text inside editors or action buttons. Show the shared composer immediately with the selected quote; create the side chat on first submit. Failed submission preserves the draft and reuses the created chat. Verified source markers reopen retained chats; overlapping markers offer a choice. Do not show a header history list, repeated excerpt or persistence status. Preserve the main reading position and active branch.

The side chat has no model, prompt, or saving controls. The default prompt asks for brief explanations and use of inherited tools or MCP when needed. It forbids sub-agents and changes to files, Git state, configuration or permissions unless the user requests the specific change in this side chat. Main-chat and quoted authorization do not count. Requested changes must stay minimal and avoid interfering with the main conversation. These are prompt instructions, not a runtime enforcement boundary; existing chats retain their saved prompt. Ordinary chat passes the current composer's uniquely resolved model on creation, submit, and retry; multiple selected models require a single selection in the main composer. Agent sources use `agent-session:<sessionId>`; Main validates the real session, message ownership and ancestor branch and resolves the owning Agent's current model at request admission. The next submit or retry follows a changed main model; in-flight requests retain their captured model. Missing or invalid models use the existing model error without clearing drafts/history or falling back to a saved model. Reuse `MessageList` and `ComposerSurface`, with isolated window-memory drafts and menu state, without model/prompt/persistence settings or recursive side chats. Inherit the source assistant or Agent tool/MCP configuration and disabled rules on each request. Reuse the common composer controls, excluding New Task, web-search and image-generation toggles; hiding these toggles does not disable inherited capabilities. Agent-only skills, permission mode and slash commands are not connected yet. Preserve attachments, knowledge selections and turn options across retry and approval continuation. Tool results and approval cards use the shared message components. Resume only after all approvals for that answer are decided, keeping its original model and answer identity. Temporary messages and tool results remain in memory without tool-output offloading. Saved attachments reuse file ingestion; temporary attachments use original paths or in-memory images. Display available token usage through the shared message statistics.

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

The header close button collapses the panel without clearing it. A separate icon-only delete action asks for confirmation; successful deletion collapses that chat without closing a newer panel selected while deletion was pending. Distinguish collapse from the runtime close operation that clears a temporary side chat. Cancellation must invalidate late stream callbacks so cleared content cannot reappear.

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

- AC1 — Answer selections in ordinary chat and Agent sessions open the shared composer directly, and verified source markers reopen retained side chats without moving the main reading position or changing its active branch. (verification: Electron)
- AC2 — Captured requests contain only the defined source snapshot and current side history; later main messages and other side chats do not leak into requests. Oversize context is disclosed or rejected as specified. (verification: unit)
- AC3 — Main and side chat generate concurrently; stopping either does not stop the other, and closing a temporary chat rejects late stream updates. (verification: unit and Electron)
- AC4 — Submit and retry follow the current main model, including after a model switch; in-flight requests do not change. Invalid models preserve history and drafts. The shared list/composer render inherited tools, approvals and attachments without model/prompt/persistence settings, New Task, web-search or image-generation toggles, or recursive entries. (verification: renderer and Electron)
- AC5 — Two submitted questions count as two, retry stays at two, deletion reduces the count, failed generation still counts, and clearing temporary chats removes their contribution. (verification: unit and renderer)
- AC6 — Saved history, model/prompt, source snapshot, and markers restore after restart. (verification: Electron)
- AC7 — Temporary content clears on explicit close or window close and leaves no matching body in the database, persistent caches, backup, or application logs/traces. (verification: unit and Electron)
- AC8 — No side-chat settings are exposed. The existing enabled default affects only creation; existing saved and temporary chats keep their original mode and history. (verification: unit and renderer)
- AC9 — Switching topics or preview panels retains drafts and generation state under the correct side-chat identity. (verification: renderer and Electron)
- AC10 — Verified source markers reopen their chats, with a choice for overlapping markers. Edited, regenerated, repeated, or deleted text never marks an unverified location; rendered quotes remain valid even without exact source offsets, without guessing a highlight location. (verification: unit and Electron)
- AC11 — Main-topic and Agent-source soft deletion, restoration, and permanent deletion update saved and temporary associations consistently; ordinary topic lists and main export exclude side chats. (verification: unit and Electron)
- AC12 — Backup/restore preserves saved side chats and their source links and omits temporary chats. (verification: unit and Electron)

## Risks

Persistent-topic coupling may enlarge the generation change. Topic filters and deletion/backup consumers can omit associations. Persisted tracing may defeat temporary mode. Rendered text may not map uniquely to source text. These risks must not weaken the behavior defined above.
