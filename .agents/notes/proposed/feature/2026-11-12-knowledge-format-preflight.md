# Agent Note: Preflight knowledge files before ingestion

Status: proposed

English | [中文](2026-11-12-knowledge-format-preflight.zh.md)

Tracks [CherryHQ/cherry-studio#18985](https://github.com/CherryHQ/cherry-studio/issues/18985). Parser quality for complex files stays out of scope and belongs to format-specific follow-up issues.

## Problem

Knowledge file support is decided in code but never explained to the user before ingestion starts.

- The extension allowlist `knowledgeSupportedFileExts` (`src/shared/utils/file/fileExtensions.ts:8`) filters the renderer picker and dialog (`src/renderer/pages/knowledge/components/AddKnowledgeItemDialog.tsx:44-49, 227, 244`). Skipped files produce only a count toast (`unsupported_files_skipped`).
- The main process rejects unsupported extensions with a generic error (`assertSupportedKnowledgeFilePath`, `src/main/features/knowledge/ingestion/KnowledgeIngestionService.ts:771-773`).
- There is no size or page-count check.
- An image-only or scanned PDF is detected only after reading, when `indexDocumentsJobHandler` finds no indexable text and fails the item (`src/main/features/knowledge/tasks/indexDocumentsJobHandler.ts:102-110`). The user learns this after the job runs.
- Whether OCR or an online processor is required for a file is not shown per file. `FileProcessingSection.tsx` only surfaces a configuration-level local OCR hint.
- No user-facing matrix publishes the effective format, size, page, scan, and processor rules.

## Proposal

1. **One support matrix.** Add a shared definition in `src/shared/data/presets/` that lists, per format: accepted extensions, size limit, page limit (PDF), whether scanned input needs OCR, and the processor that handles it. Derive `knowledgeSupportedFileExts` and the picker filter from it.
2. **Shared preflight function.** A pure function in `@shared` takes file metadata (name, size, page count when cheap to read) and returns either `ok` or one reason code: `unsupported_format`, `size_limit`, `page_limit`, `ocr_required`, or `processor_not_configured`. The renderer and the main process both call it.
3. **Renderer preflight.** Run it when files are selected. Show a per-file reason and block only the files that fail. Passing files continue as today.
4. **Main-process preflight.** Run it in `KnowledgeIngestionService` before copy or enqueue. It returns the same reason codes to IPC callers, so the renderer cannot bypass the rule.
5. **Scan and processor gate.** Scanned PDF detection stays a cheap check on text-layer presence when the file is selected. If OCR is required and no processor is configured, block with `processor_not_configured` and link to the file-processor setting. The existing post-read empty-text failure stays as a backstop.
6. **Docs.** A user-facing matrix in English and Chinese, generated from the same shared definition so it cannot drift.

Open decisions for approval before implementation:

- Size and page limits: exact values per format, and whether they are enforced or only warned.
- Whether a missing OCR processor blocks the file or only warns, given that a scanned PDF fails today anyway.
- Whether page count is read eagerly at selection, which can cost time on large PDFs.

## Alternatives considered

- **Keep failures post-read and only improve messages.** Rejected as the sole fix: the issue requires the reason before ingestion starts, and a post-read failure still wastes a job and an item row.
- **Validate only in the renderer.** Rejected: IPC and future callers would bypass the rule.
- **Extend the completion-callback Spec** (`proposed/architecture/2026-10-25-knowledge-file-processing-completion-callback.md`). Rejected: that note owns how an item waits for a processing result. This Spec owns what is accepted before any item exists. The two stay separate and cross-linked.

## Acceptance criteria

- AC1 — An unsupported extension is rejected in the picker and in the main process with reason `unsupported_format`, before any copy or enqueue (verification: renderer and unit)
- AC2 — A file over the configured size or page limit is rejected with `size_limit` or `page_limit` before ingestion (verification: unit)
- AC3 — A scanned PDF with no OCR processor configured is blocked with `processor_not_configured` and a link to the processor setting, before ingestion (verification: renderer)
- AC4 — A supported PPTX passes preflight and shows the selected processor, with no change to parsing output (verification: unit)
- AC5 — The renderer and main process return identical reason codes for the same input (verification: unit)
- AC6 — The published matrix is generated from the shared definition, and the English and Chinese pages pass the bilingual pairing check (verification: docs gate)

## Risks

- Page counting can be slow on large PDFs; the check must have a bounded cost or be skipped with a warning.
- Matrix values drift from actual reader behavior unless tests pin the shared definition to the readers (`ReaderFactory.test.ts` already covers extension routing).
- Blocking scanned PDFs when no OCR is configured changes an outcome users see today as a late failure; this needs explicit approval.
