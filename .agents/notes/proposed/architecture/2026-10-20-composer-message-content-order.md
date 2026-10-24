# Agent Note: Preserve Composer content order in user messages

Status: proposed

English | [中文](2026-10-20-composer-message-content-order.zh.md)

## Problem

A user composes `text A → image A → text B → file B → text C`, but the model receives grouped text followed by attachments. The attachment's position is part of the user's meaning: moving it changes what “this image” refers to.

At the inspected source revision `6550a6c9f4c`, `createComposerUserMessageParts` emits one text part with a Composer snapshot. Both `ChatComposer` and `AgentComposer` append file parts at send time. The snapshot retains each file token's UTF-16 `textOffset`, but `buildAgentUserContent` joins text before appending file paths, and `ClaudeCodeRuntimeDriver.materializeUserContent` separately collects text, images, fallback paths, and unavailable attachments. Fixing only one stage would still lose order.

The current shared attachment router already replaces files in place and allocates extraction budgets across the request. That behavior should be preserved. Editing, rendering, copying, and attachment eligibility also consume Composer snapshots, so changing only the outgoing array would risk duplicated or missing attachments.

This proposal covers single user-message content order in Chat and Agent Composer, including queued sends, editing/resending, retries, and Agent steer. It does not change the order of separate messages, add attachment capabilities, or promise that a model understands positional references. Related report: [Issue #21554](https://github.com/CherryHQ/cherry-studio/issues/21554).

## Proposal

### One order in the message contract

New Composer sends persist `MessageData.contentFormat: "ordered-parts-v1"` with `parts` in reading order:

```text
text("text A") → file(image A) → text("text B") → file(file B) → text("text C")
```

The marker is optional for existing messages. Carry it through send/edit schemas, queue payloads, persistence, and `CherryUIMessage.metadata`; schema validation must reject unsupported marker values. This uses existing JSON storage and requires no SQLite migration. `parts` owns attachment membership and order for marked messages; the marker selects that contract, and Composer metadata must not override it.

Persist non-file Composer tokens on their owning text segment with segment-local offsets. Represent a file by its actual file part, retaining `providerMetadata.cherry.fileTokenSourceId` and the existing file metadata; do not also persist it as an inline file token on a text part. A token-only segment may retain an empty text part when required to preserve a non-file token.

### Build ordered parts at the send boundary

Normalize the complete draft once with the existing Composer normalization before computing segments. After attachments have been materialized, one renderer-owned assembly function pairs `file:<sourceId>` tokens with file parts by `fileTokenSourceId`, orders tokens by `textOffset` and then `index`, and splits that normalized draft at the corresponding UTF-16 offsets. Reuse existing file builders and serialization helpers. Never match by filename, attachment-array index, or completion order.

Do not trim individual text segments or insert separators between them. Preserve Chinese text, emoji, Markdown spaces, and line breaks. Multiple attachments at the same offset retain token order; repeated references to the same physical file remain distinct token occurrences. Non-file tokens retain their relative position, including when they share an offset with a file.

Resolve membership from the submitted draft snapshot, not later live Composer state. A deleted token cannot reintroduce an attachment. A new send with a missing or ambiguous token-to-part association fails through the existing send failure path and preserves the draft or queued payload; it must not guess a position or silently omit content. Queue submission and retry reuse the captured payload, and only successful sends clear it. Knowledge scope and other hidden control parts keep their existing semantics outside the ordered visible content.

### Preserve order through model conversion

The Chat attachment router continues replacing each file at its position with native content, extracted text, or its existing failure note. Preserve request-wide extraction budgets, tool allow-lists, capability gates, cancellation, and errors that currently stop a provider request. Eligibility checks for marked messages use actual file parts, so removing duplicated Composer file tokens does not deactivate attachments.

Claude Code walks the resulting content sequence without partitioning it into text and attachment groups. Supported images become image blocks at their original position. Other files become the existing filename/path representation at that position; OCR results and permitted unavailable-file notes occupy the same position. Resolve managed paths through the existing file service and retain its readability checks. Shared preparation must retain origin associations when one input attachment produces replacement content; do not independently prepare each file and thereby reset budgets or handle allocation.

Pi keeps its current text/path capability and renders each file reference between the corresponding text segments. It does not gain native image support through this change. Normal prompt, steer, and reconstructed history use the same ordered conversion.

Request-level attachment manifests may remain after the user content; they are supplementary tool metadata and do not replace inline attachment positions. Delivery wrappers and untrusted-content handling retain their security boundary around all user-derived text. Apply wrappers after ordered content conversion; do not feed transformed text back into Composer offsets.

### Round-trip and existing messages

For marked messages, editing reconstructs the draft by concatenating text segments without invented separators and inserts file tokens at their part positions. Convert non-file token offsets back to draft offsets, preserve stable attachment identities, and rebuild the ordered message on save/send. Moving, deleting, or adding an attachment updates both membership and order. Keep existing assistant-message tool anchors intact.

Message display, copy, Markdown export, and text extraction traverse marked messages in part order. Render each file once at its location; do not hoist it or duplicate it as both a file block and a Composer chip. Plain-text projections can use the existing attachment labels/paths but must retain their position. Metadata-only empty text parts must not add visible blank blocks.

Unmarked messages retain their stored order and legacy attachment-eligibility rules. Do not rewrite the historical database or guess old insertion points from filenames. When an old message is explicitly edited, restore reliable existing Composer token identities and offsets; unmatched attachments remain at the end of the editable draft with fresh identities. That new submission receives the ordered format. Unmarked Gateway messages that already supply interleaved parts keep their supplied sequence.

### Ownership and delivery

Shared message types and schemas own the format discriminator. Renderer Composer utilities own draft-to-parts assembly and edit restoration. Main attachment routing and runtime adapters consume ordered parts without learning Composer layout. Shared message presentation and export own their projections.

Deliver through a Spec-first stack: this bilingual contract; a contract/Composer/persistence/editing layer; then a runtime/presentation/verification layer. Intermediate layers retain the proposed note. The final layer moves the triplet to implemented only after every criterion below has actual evidence. Keep changes limited to consumers whose existing grouping or metadata rules would violate this contract.

## Alternatives considered

- **Sort attachments only.** This leaves all text before them, so it does not preserve text-to-attachment relationships.
- **Reconstruct offsets separately inside each runtime.** This couples runtimes to Composer internals, duplicates compatibility logic, and leaves stored messages and editing inconsistent.
- **Change parts without a format discriminator.** Existing eligibility and display logic treats Composer file tokens as attachment membership; changing their meaning implicitly can hide valid files or revive stale ones.
- **Keep a parallel ordered content list.** Two authorities would need synchronization across edits, persistence, and retries. The existing `parts` array can express the order.
- **Infer historical associations from names or array position.** Duplicate names and missing identities make this unsafe. Preserve legacy messages and only upgrade an explicitly edited draft.

## Acceptance criteria

- AC1 — Chat and Agent persist and submit `text A → image A → text B → file B → text C` in that exact order, including file-first, file-only, adjacent files, and equal-offset tokens (verification: renderer assembly and Composer send tests)
- AC2 — Chinese, emoji, newlines, Markdown hard breaks, indentation, and non-file tokens survive assembly and edit round-trips without added separators, trimmed segments, or shifted token positions (verification: renderer draft and message-editing tests)
- AC3 — Same-name files and repeated references retain distinct identities; async materialization finishing out of order cannot reorder parts; missing or ambiguous new-send associations preserve the unsent draft or queue item and do not call the send boundary (verification: renderer Composer and queue tests)
- AC4 — Save/reload, queued send, retry, edit/resend, and Agent steer preserve the format marker, order, and exact attachment membership; deleted files never reappear (verification: schema, real database persistence, renderer consumer, and runtime input tests)
- AC5 — Chat provider input and Claude Code SDK input preserve native images, extracted/OCR content, file paths, and permitted failure notes at their source positions; existing budgets, capability failures, path resolution, and attachment allow-lists retain their contracts (verification: main attachment-routing and provider/runtime adapter tests)
- AC6 — Pi prompt, steer, and history reconstruction preserve interleaved text/path references; delivery content stays within its existing trust boundary across runtime adapters (verification: main Agent content, Pi, Claude Code, and delivery tests)
- AC7 — Display, editing, copy, and export retain marked message order and render each attachment once; legacy messages remain readable, ambiguous legacy attachments are not guessed, and unmarked interleaved Gateway inputs retain their supplied order (verification: renderer presentation/export, main conversion, and legacy fixture tests)
- AC8 — A tracked Electron instance demonstrates an interleaved Chat send and Agent send, reload, attachment move/delete, edit/resend, and queued submission, with persisted parts and captured adapter/provider inputs agreeing with the Composer (verification: Electron evidence; provider/model comprehension is outside this acceptance claim)
- AC9 — The final implementation includes only the verified change scope, updates semantically affected reference-document pairs, and records exact focused checks and outstanding platform/provider limits (verification: change scope, docs impact inspection, changed-file formatting/lint, affected type checks, focused tests, and docs gate)

## Risks

Missing marker propagation could make an ordered message fall back to legacy eligibility and lose files. Persistence, projection, queue, and edit boundaries require round-trip tests before the feature is complete.

Splitting text exposes consumers that join text with newlines or read only the first Composer snapshot. Audit those consumers within the affected send/edit/display/export paths instead of adding a second full-text authority.

Claude Code currently groups attachments by routing class. Its replacement must preserve file identity, global preparation decisions, and delivery security boundaries while reassembling content. SDK-call evidence proves the payload produced by Cherry Studio, not remote model interpretation.

Older app versions do not understand the marker and may display or resend new messages incorrectly. This proposal guarantees old-message readability in the updated application, not backward editing by an older binary. No historical data rewrite or automatic downgrade is included.

No implementation or runtime validation has been completed by this Spec. Its acceptance criteria remain pending until the implementation layers supply evidence.
