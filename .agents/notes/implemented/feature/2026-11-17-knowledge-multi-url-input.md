# Agent Note: Accept multiple knowledge URLs in one dialog submission

Status: implemented

English | [中文](2026-11-17-knowledge-multi-url-input.zh.md)

## Problem

Adding several webpage sources required repeating a single-URL dialog. A mixed paste needs actionable errors without losing valid entries or importing them again after a correction.

## Decision

The dialog splits input on physical line breaks, commas, and whitespace. The help text explicitly identifies commas as separators and instructs users to write `%2C` for a comma within a URL; this does not guarantee successful fetching. It retains each token's original line and batch position, validates with shared `isHttpUrl`, and preserves the trimmed original value and duplicates. It submits all valid entries in one existing `knowledge.add_items` batch using `detect`, without waiting for fetching or indexing. When the input yields more than one token, the panel lists the parsed valid targets before submission, bounded to 100 entries plus a remainder row, so a comma-containing paste shows which target is actually accepted; a single valid URL keeps the panel unchanged.

Conflict retries replay the captured valid items and invalid entries with `rename` or `replace`. Detecting conflicts accepts nothing and leaves the input intact; cancelling restores editing of that input. Editing is disabled during submission and conflict selection. Cancelling a pending URL submission still closes the dialog; its results and errors cannot change a later dialog session.

After acceptance, an entirely valid batch closes the dialog. A mixed batch keeps it open, replaces the input with only unsubmitted invalid tokens, and reports accepted inputs and entries to correct. Correction therefore cannot resubmit already accepted entries. An IPC or database exception remains a batch error without a partial-success claim.

The [URL validation decision](../bug-fix/2026-11-07-knowledge-url-validation.md) still owns IPC validation: mixed invalid IPC requests are rejected in full. Filtering belongs to the dialog before that boundary. The ingestion pipeline, URL identity, job queues, fetch concurrency, and file/directory/note flows retain their existing contracts.

## Alternatives considered

- Rejecting the whole paste would prevent valid entries from being accepted until every token was corrected.
- Separate per-URL requests would change batch conflict semantics and add IPC overhead.
- Closing with a toast would discard correction context; leaving accepted URLs in the input would risk duplicate imports.
- Normalizing or silently deduplicating URLs would change source identity and conflict choices.

## Consequences

The multiline field has an accessible label and bounded height. Invalid feedback wraps long tokens, scrolls, and renders at most 100 entries plus a remaining count; this is a feedback limit, not a submission cap. Renderer catalogs provide separator instructions, individual errors, valid count, and acceptance result in all 17 languages.

Acceptance means inputs were admitted to the existing processing pipeline, not that indexing completed or that input count equals net new database rows under replacement. Arbitrarily large batches still have synchronous ingestion costs. Electron layout, theme, and responsiveness verification remains a manual validation gap in the restricted environment.

## Verification

- AC1 — `src/renderer/pages/knowledge/utils/__tests__/parseKnowledgeUrls.test.ts`: mixed separators preserve physical lines, token order, raw URL spelling, and duplicates while rejecting non-HTTP(S) inputs.
- AC2 — `src/renderer/pages/knowledge/components/__tests__/AddKnowledgeItemDialog.test.tsx`: ten valid URLs submit once; nine valid plus one invalid retain only the invalid token, and its correction submits once without the accepted nine.
- AC3 — `src/renderer/pages/knowledge/components/__tests__/AddKnowledgeItemDialog.test.tsx`: duplicate-URL conflict choices replay the valid snapshot; cancellation preserves input; exceptions report batch failure; late URL acceptance, conflict, and error results leave a reopened session untouched; direct picks and note workflows retain regression coverage.
- AC4 — `src/main/features/knowledge/__tests__/KnowledgeService.integration.test.ts`: ten URL inputs persist ten distinct IDs with matching URL data and initial `processing` status in an empty active base.
- AC5 — `src/renderer/pages/knowledge/components/__tests__/AddKnowledgeItemDialog.test.tsx` and `scripts/i18n-check.ts`: invalid feedback is capped at 100 entries with a remainder; all renderer translations pass catalog validation.
