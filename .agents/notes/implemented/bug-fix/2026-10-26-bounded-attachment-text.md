# Agent Note: Bound plain-text attachment extraction before decoding

Status: implemented

English | [中文](2026-10-26-bounded-attachment-text.zh.md)

## Problem

`extractDocumentText` reads and decodes an entire plain-text attachment before `attachmentBudget` can limit its inline text. Token budgeting therefore cannot bound the initial read, decoder allocation, or tokenizer input. Issue #22667 reports an approximately 11 MB Markdown attachment with an extremely long inline-image text block crashing the app; the original file, app version, crash layer, and logs are unavailable, so that crash remains unconfirmed.

## Decision

Plain-text, unknown-extension, and extensionless extraction accepts at most 8 MiB of source bytes. This is a local resource ceiling matching the existing text-preview ceiling numerically; extraction owns its constant independently. Check the current file version before reading, then use `FileManager.readChunk` with one overflow byte so growth after the check cannot cause a whole-file allocation. Reject overflow before decoding or caching. Keep PDF and Office parser routing unchanged.

`AttachmentTextTooLargeError` uses the existing localized document-size error and the payload error category. Chat preparation propagates it to the user instead of replacing it with a generic model-only unreadable-file note. The same extraction guard applies to `read_file`.

## Alternatives considered

- Only truncate after tokenization: leaves the initial unbounded work intact.
- Silently decode a bounded prefix: could truncate an inline image or multibyte encoding and pretend the whole document was read.
- Limit all attachment formats: would change native media and document-parser behavior outside this report's text path.

## Consequences

Text attachments larger than 8 MiB must be split or reduced. Ordinary text still uses its existing encoding-aware decoder and version cache. This ceiling bounds this extraction path, but does not establish the reporter's crash cause or bound PDF/Office parsers, native media, total attachment count, or renderer ingestion.

## Verification

- Regression — `pnpm test:main` with explicit paths for `attachmentTextExtraction.test.ts`, `attachmentRouting.test.ts`, `attachmentBudget.test.ts`, and `ReadFileTool.test.ts`: 90 tests pass. The new 11 MiB rejection test fails against the original extraction source because the promise resolves instead of rejecting; this is a unit regression, not reproduction of the reported application crash.
