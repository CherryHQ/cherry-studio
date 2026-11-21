# Agent Note: Paragraph-level AI edits in assistant replies

Status: proposed

English | [中文](2026-11-22-paragraph-ai-edit.zh.md)

## Problem

Issue #13304 requests an AI-assisted edit of one selected paragraph, such as shortening it or fixing grammar, without regenerating the whole reply. Copying text into a new prompt loses the source location and makes the user manually reconcile the result.

The current selection toolbar and context menu extract text for copy, quote, and Save to Notes. They do not provide a stable write target. `ChatMarkdown` renders message text parts, while the ordinary Chat and Agent session adapters own different persistence and edit permissions. The existing topic-message edit action replaces the parts array; it is not a compare-and-set paragraph operation.

## Proposal

### Eligible target and source identity

Offer Edit with AI from the selection toolbar and context menu when a selection lies within one eligible paragraph of a completed, editable assistant text part in a persisted Chat topic or Agent session. A partial selection selects that paragraph as the edit unit; the panel clearly previews the complete targeted paragraph before any model request. Keyboard selection and keyboard invocation work too.

Eligibility follows the existing domain edit permission, including Agent history restrictions and active-run guards. User messages, live replies, reasoning, tool output, code blocks, tables, standalone HTML previews, and selections across paragraphs or messages are not targets. Paragraphs containing citation markers or embedded formula/rendered content without a reversible source mapping remain unavailable with an explanation, rather than being flattened or guessed. This is not a general Canvas workspace or file editor.

Carry the owner kind, topic/session ID, message ID, text-part identity, source range, and a content revision/hash captured from canonical message data. Rendering must expose a source mapping for the eligible paragraph. DOM text, text search, and the first matching occurrence are not write coordinates. Repeated identical paragraphs, inline Markdown, escaped text, Unicode, and multiple text parts must still identify exactly one canonical range. If preprocessing breaks that mapping, do not offer the action.

### Request and review

Open one shared inline review panel with the original paragraph, an instruction field, a visible model selector, Generate, and Cancel. Initially select the producing model if it is still configured and supports text; otherwise require an explicit available model choice. Opening the panel makes no request. Generate sends only the selected paragraph's raw Markdown, the instruction, and at most 500 Unicode characters from each adjacent paragraph in the same text part, labeled read-only context. Show that context and its scope before Generate. Do not send the whole conversation, attachments, tools, credentials, or other message parts.

Main owns a separate cancellable text-only generation operation through the existing model/provider resolution and stream infrastructure, following the one-shot translation ownership pattern without changing the translation protocol. It has no tool execution or file/network capabilities beyond the selected provider request. Treat target/context text as quoted input, not authority to broaden the operation. Record usage under the selected model and operation, separate from the original reply's generation statistics.

Stream the proposed replacement only inside the panel. Never overwrite the message while generating. Show errors and permit retry with the original unchanged. Cancel, navigation away, target removal, or panel teardown aborts the owned request; late chunks cannot reopen the panel, alter another selection, or write the message. One panel/request is active per editing owner, with a generation identity preventing stale-result reuse.

After generation, show an original/replacement comparison and allow editing the proposed Markdown before Apply. Empty output cannot apply. Retry discards only the prior proposal. Cancel discards the proposal and restores focus/reading position. Applying is always a separate explicit action; it never regenerates descendants or triggers another model call.

### Safe persistence and undo

The domain adapter sends an explicit paragraph replacement to a Main-owned mutation. In one database transaction, Main checks owner/message access, current edit permission, terminal status, source identity/revision, exact old range, and expected old text, then replaces only that range. A stale revision, moved/deleted message, changed part, or newly active execution rejects without a write and keeps the proposal available for copying or deliberate reselection. Do not silently rematch similar text or overwrite concurrent edits.

Outside the chosen range, text bytes and non-derived non-target parts stay unchanged. Derived translation/context invalidation is the explicit exception described below. Keep message identity, tree/sibling relationships, other model responses, delivery attribution, and original usage records. Invalidate changed-text provider/citation/composer-derived metadata using the existing edit semantics; do not retain stale generated-item IDs or fabricate citation validity. Reconcile derived translation/context state through the domain's existing edit invalidation, and document those effects in the panel. Do not reuse a whole-array renderer patch as the concurrency guard.

After a successful Apply, offer a one-step Undo for that edit. Undo uses the resulting revision and exact replacement range as its precondition. It restores the original source and corresponding edit-invalidated metadata only if nothing subsequently changed; otherwise it refuses without overwriting newer content. Persist the applied content across reload. The proposal and undo handle need not survive application restart; the panel must not promise persistent history.

### Ownership and delivery

Shared selection/message modules own capture and the review UI. Chat and Agent adapters provide domain permission, target loading, apply, and undo capabilities. Main owns provider calls, cancellation, input validation, compare-and-set writes, and existing history invalidation. Shared schemas contain cross-process contracts only; renderer-only mapping helpers remain in renderer ownership.

Implement in reviewable layers: source targeting and guarded persistence first, generation/review UI next, then both domain adapters and native acceptance. Keep this note proposed until all criteria have actual evidence. No broad editor replacement, automatic acceptance, external document mutation, batch editing, autonomous tool use, or whole-reply rewrite is included.

## Alternatives considered

- Quote the selection into a normal chat prompt: easy but sends conversation context and leaves manual reconciliation, the core problem unchanged.
- Replace the first matching text in the stored reply: corrupts repeated paragraphs and cannot defend against concurrent edits.
- Mutate the rendered DOM: not persistent and loses Markdown/source semantics on rerender.
- Reuse the existing full-message save with a stale parts array: can overwrite newer text or unrelated parts.
- Add a complete Canvas editor first: much larger scope than the requested paragraph operation.
- Apply streamed output automatically: removes review and can leave partial or failed content persisted.

## Acceptance criteria

- AC1 — Mouse and keyboard selection open one accessible review panel for exactly the eligible paragraph in both persisted Chat and Agent replies; unsupported or non-editable selections explain why no edit is offered. (verification: renderer and Electron)
- AC2 — Repeated paragraphs, Unicode, inline Markdown, multiple parts, and preprocessing boundaries resolve the correct canonical range or safely refuse; no DOM/text-search guess is accepted. (verification: unit and renderer)
- AC3 — Opening makes no model request; Generate uses the visibly selected model and sends only the target, instruction, and displayed bounded adjacent context, with tools disabled and separate usage accounting. (verification: main and renderer)
- AC4 — Streaming remains a proposal; retry, provider failure, cancellation, owner change, and late results never mutate a reply or another panel. (verification: main, renderer and Electron)
- AC5 — Explicit Apply updates exactly one source range, preserving other text/parts, sibling/tree identity and original usage, and correctly invalidates changed-text derived state in both domains. (verification: database and renderer)
- AC6 — Concurrent edit, target deletion/move, changed eligibility, and duplicate submission are transactionally safe; rejected applies preserve the proposal and never rematch or overwrite newer content. (verification: database and renderer)
- AC7 — Applied edits persist after reload; Undo restores the prior range only with a matching post-apply revision and refuses after a subsequent change. (verification: database and Electron)
- AC8 — Both languages, accessible focus/reading continuity, narrow/light/dark layouts, provider errors, and existing copy/quote/Notes/manual-edit flows pass scoped checks and native acceptance, with unverified boundaries reported explicitly. (verification: renderer, docs gate and Electron)

## Risks

Source-to-rendered mapping is the main correctness boundary. Markdown transformations and repeated text make visual selection alone insufficient. The first layer must demonstrate reversible targeting before generation UI can be called safe.

Editing historical Agent output is not universally permitted. Reuse Main's history eligibility and cache invalidation instead of adding a bypass or assuming parity with topic messages. A renderer capability flag is a presentation hint, not final write authorization.

A paragraph edit changes future conversation context and can invalidate derived translations or context summaries. Preserve unaffected content, explain these effects, and never claim that an existing citation still supports rewritten text merely because its marker was retained.

Model calls incur the configured provider's usage. Generate is explicit, model/context scope is visible, and no background retry occurs. This Spec performs no call and makes no price or token-savings guarantee.
