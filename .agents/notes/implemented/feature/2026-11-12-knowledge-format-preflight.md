# Agent Note: Preflight knowledge files before ingestion

Status: implemented

English | [中文](2026-11-12-knowledge-format-preflight.zh.md)

Tracks [CherryHQ/cherry-studio#18985](https://github.com/CherryHQ/cherry-studio/issues/18985). Completes the original issue without changing parsing output or imposing invented local-reader limits. Supersedes the design-only note in [Spec PR #24312](https://github.com/CherryHQ/cherry-studio/pull/24312).

## Problem

File admission used an extension allowlist and failed after ingestion for scanned PDFs or processor limits. Users could not review the selected reader, limits or missing processor before import. A replace batch could delete existing material before a later file failed.

## Decision

The format catalog owns supported extensions and reader labels, and the picker and review table consume it. Main preflight reads actual file metadata and PDF text-page information locally without network calls or processor jobs. Blank and mixed PDFs need a configured document processor. Configuration checks reuse the production platform and local-model gates and check API credentials and host. Remote connectivity and document parsing quality remain separate checks.

Existing processor caps are used exactly: bytes at the cap are rejected and pages above the cap are rejected. The 300-page local-document limit is now published in the shared preset and consumed by both processing and preflight. Local readers have no new application-defined size or page limit. PDF inspection is limited to 30 seconds after parser initialization and always destroys the parser.

The file and folder picker and page-level drops show per-file results, selected reader and effective limits before submitting. The review links to document processor configuration, supports cancel without import, and imports only ready individually selected files. A folder containing a supported but blocked file must be fixed before import; unsupported folder entries remain skipped under the existing policy. Main repeats validation before conflict cancellation, deletion, copying, row creation or enqueueing. Restored files with an existing processed artifact keep that artifact instead of requiring the original processor again.

## Alternatives considered

- Renderer-only validation would allow direct callers to bypass admission. Rejected.
- Arbitrary global file/page caps would change product behavior without an existing limit. Rejected.
- Sampling PDF pages would miss mixed documents. Inspect all pages instead, with timeout and parser cleanup.
- Testing remote credentials during selection could send private files or use quota. Preflight does neither and does not promise remote availability.

## Verification

- AC1 — unsupported formats are individually explained before import, and rejected by Main. Real filesystem and renderer tests cover this.
- AC2 — effective existing processor byte/page limits are checked before copy or enqueue. Real PDF fixtures cover exact byte boundaries and page overflow.
- AC3 — blank and mixed PDFs without a configured processor are blocked with a settings recovery action. Real PDF parsing and review UI tests cover this.
- AC4 — PPTX reports local anydoc independently of the PDF processor. Existing ReaderFactory tests cover reader routing, not unrelated layout quality.
- AC5 — both UI and admission use the same Main preflight and shared result codes; admission repeats the check before side effects. Real-database replacement regression preserves the old note on failure.
- AC6 — the review support table renders the same catalog used by admission and picker, with English and Chinese copy. Documentation pairing and governance checks cover the note and guide.

## Consequences

No live remote document upload or paid embedding call is part of verification. Office formats needing anydoc are blocked on Windows ARM64 where no reader exists; DOC, DOCX and EPUB retain their existing fallback. Complex layout quality remains a parser-specific follow-up to [#12854](https://github.com/CherryHQ/cherry-studio/issues/12854), not a claim made by admission. A file can change after inspection; actual readers and processor limits remain backstops.
