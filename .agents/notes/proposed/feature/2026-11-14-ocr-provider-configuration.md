# Agent Note: Let users configure the OCR provider, model, and options

Status: proposed

English | [中文](2026-11-14-ocr-provider-configuration.zh.md)

Resolves [issue #20286](https://github.com/CherryHQ/cherry-studio/issues/20286). Builds on [the FileProcessing task model](../../implemented/architecture/2026-10-29-file-processing-task-model.md), which owns the `image_to_text` processor boundary.

## Problem

Settings → OCR already selects the `image_to_text` processor and stores per-processor overrides (`FileProcessorOverride`, `capabilities.image_to_text.modelId`) through `useFileProcessingPreferences`. Four gaps remain against the issue:

- **Model choice is narrow.** Only PaddleOCR exposes a model field, and its options are hardcoded in `PaddleOcrModelSettings.tsx` (`PP-OCRv6`, `PP-OCRv5`). Other providers' `modelId` (for example Mistral's `mistral-ocr-latest`) can be set only by preset.
- **No reset.** An override persists until the user edits each field; there is no action that restores the preset provider, model, and options for a processor.
- **Unsupported combinations are not validated before save.** API host validation exists, but nothing checks that the chosen model is one the provider declares, that the processor supports the requested option, or that a required local model is installed, before the value is written.
- **Scope is not explained, and one entry point is separate.** `image_to_text` currently drives chat `read_file` OCR (`ocrImageToText.ts`) and translate-page images, not knowledge image ingestion. `KnowledgeIngestionService` rejects PNG/JPEG files at its supported-extension check; its existing file-processing route uses `document_to_markdown` with the knowledge base's `fileProcessorId`. Knowledge-image OCR therefore requires new ingestion and routing work, not only Settings changes. Screenshot region OCR (`ScreenshotOverlayService.recognizeText` → `recognizeScreenshotText`, `OcrInferenceService`) uses its own runtime and does not read `image_to_text`. Scanned PDF pages go through `local-document`'s OCR (`pdfPageOcr.ts`). The Settings page does not say which applies where.

Existing users have no override, so their resolved processor is the platform default from `resolveDefaultImageToTextProcessor` (system OCR on macOS and Windows, Tesseract elsewhere). That behavior must not change.

## Proposal

- **Model picker.** For each processor, derive the selectable models from its preset capability (`FILE_PROCESSOR_PRESET_MAP`), not from per-processor UI code. Keep `PaddleOcrModelSettings` as the rendering of that list for PaddleOCR. A processor whose preset declares one model shows it as fixed text.
- **Option support.** Show a field only when the selected processor's preset declares that option (languages for Tesseract and System; model for PaddleOCR and Mistral; API host for remote processors). Do not expose arbitrary provider parameters.
- **Validation before save.** `setCapabilityField` is called only after the value passes a shared check in `src/shared/data/presets/fileProcessing.ts`. The check rejects: a processor without the `image` input for `image_to_text`; a model not in the preset list; an option the processor does not declare; an empty or invalid API host; a local processor whose required local model (`FILE_PROCESSOR_LOCAL_MODEL`) is not installed. The rejection is shown inline next to the field with the reason and the fix (for example "Download the local OCR model in Local Models first").
- **Reset to default.** A "Reset to default" action on the processor panel deletes that processor's override (`FileProcessorOverride` for `image_to_text` and its capability entry) and restores the preset. It runs the same validation as save.
- **One documented source for image OCR.** `image_to_text` in Settings → OCR is the only configuration for chat image OCR, translate-page image OCR, and knowledge image ingestion. To deliver this proposed knowledge-image behavior, extend `KnowledgeIngestionService` to admit supported image inputs and route those inputs through `image_to_text` using the saved OCR preference. Keep the existing `document_to_markdown` route for documents. Main-process tests must cover image admission, processor selection and rejection/error propagation. The Settings page and `docs/website` distinguish current support from this new ingestion path, including that screenshot region OCR and scanned PDF pages are configured elsewhere.
- **Compatibility.** No migration. A missing override resolves exactly as before, and the stored preference schema does not change.

Out of scope: a unified OCR page that also controls screenshot OCR or PDF OCR; free-text model IDs; new OCR engines.

## Alternatives considered

- **Free-text model field for every provider.** Rejected: the issue requires blocking unsupported combinations, and a free-text value cannot be checked against the provider's declared models.
- **Auto-fallback to the default processor when a combination is unsupported.** Rejected by the requester: the user should see the reason and fix the setting rather than silently running a different engine.
- **Route screenshot region OCR through `image_to_text`.** Deferred: screenshot OCR runs on native APIs or a local Paddle worker with its own latency and availability rules (`isScreenshotOcrAvailable`), so it would change screenshot behavior beyond this issue. The docs state the split instead.
- **Store a separate OCR configuration object.** Rejected: `FileProcessorOverride` already holds per-processor state. A second store would duplicate it and break "one configuration source".

## Acceptance criteria

- AC1 — Settings → OCR lets the user choose any `image_to_text` processor from the shared list and persist it; the choice is used by chat `read_file` OCR, translate-page image OCR, and the new knowledge-image ingestion path, including image admission and processor routing in the main process. (verification: unit on `KnowledgeIngestionService`; renderer)
- AC2 — The model picker lists exactly the models the selected processor's preset declares, and the fields shown match the options that processor declares. (verification: renderer)
- AC3 — An unsupported processor, model, option, API host, or missing local model blocks save and shows an inline message with the reason and the fix; the stored preference is unchanged. (verification: unit; renderer)
- AC4 — "Reset to default" removes the processor's override and restores the preset values; afterwards the resolved configuration equals a fresh install. (verification: unit; renderer)
- AC5 — A user with no `image_to_text` override resolves the same processor as before this change on each platform. (verification: unit)
- AC6 — The English and Chinese user docs state which configuration applies to chat images, translate images, knowledge images, screenshot OCR, and scanned PDFs. (verification: docs gate)

## Risks

- Preset model lists can drift from what a provider's API accepts. A saved model removed from a later preset resolves to the preset default; the picker shows that fallback rather than the stale value.
- A local processor whose model is later deleted fails at run time, not at save time. The run-time error must name the missing model.
- Screenshot OCR and PDF OCR remain configured elsewhere, so users may still expect one page to control everything. The docs mitigate this but do not remove it.
- Open decision for approval: whether screenshot region OCR stays separate in this Spec (proposed) or joins the `image_to_text` source in a later Spec.
