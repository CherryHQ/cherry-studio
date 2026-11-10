# Agent Note: Knowledge base image OCR

Status: proposed

English | [中文](2026-11-10-knowledge-image-ocr.zh.md)

## Problem

Knowledge base file sources reject image files (JPG, PNG, BMP, GIF, WEBP), as reported in #18442. Images carry no text layer. Only PDFs are routed through document processors, and adding image extensions to the accepted list alone would hand raw image bytes to a text reader and index binary data.

## Proposal

Accept `.jpg`, `.jpeg`, `.png`, `.bmp`, `.gif` and `.webp` as knowledge file sources in the file picker, drag-and-drop, and directory import.

Each image is recognized with the `image_to_text` capability using the processor from `feature.file_processing.default_image_to_text`, falling back to the platform default (`system` on Windows and macOS, `tesseract` elsewhere). The recognized text is written as the item's processed Markdown, `<name>.md`, the same way PDFs are handled, and indexing reads only that artifact. The original image is never read as text.

Image routing does not depend on `base.fileProcessorId`. A base whose processor is document-only (for example MinerU) still OCRs its images with the global OCR setting. If recognition returns no text, the item fails with the existing "No indexable text was extracted" message. The upload hint lists the new formats.

## Alternatives considered

- Multimodal embedding: needs an embedding model that accepts images and a new vector path. The current default models (for example `BAAI/bge-m3`) cannot do this. Out of scope.
- Use `base.fileProcessorId` for images: fails for document-only processors and bases without one, and ties image behavior to the PDF setting.
- Allow the extensions and read the bytes as text: indexes binary garbage.
- Vision LLM captioning: needs a model choice, per-image cost, and a separate approval. Out of scope.

## Acceptance criteria

- AC1 — The picker, drag-and-drop and directory import accept the six image extensions, and the upload hint lists them. (verification: renderer)
- AC2 — An image item is recognized with the default `image_to_text` processor, independent of `base.fileProcessorId`, and indexed from `<name>.md`. The binary is never passed to a text reader. (verification: unit)
- AC3 — An OCR failure or empty result marks the item failed with the existing no-text message. Cancel, delete and reindex follow the PDF processing path. (verification: unit)
- AC4 — PDF and Office routing is unchanged: `knowledgeFileProcessingExts` still gates document processing, and existing tests pass. (verification: unit)
- AC5 — A processed `<name>.md` that collides with a sibling file is handled by the existing reserved-path check. (verification: unit)
- AC6 — On Windows with the default processor, a sample PNG with known text is indexed and that text is retrievable. (verification: Electron)

## Risks

Recognition quality varies for screenshots, handwriting and low-resolution images. Windows `system` OCR needs installed language packs, and `tesseract` needs its binary and language data on other platforms. Images without text fail as items. Remote OCR processors add latency and cost during bulk directory imports. The output path reuses the PDF processing machinery, so any gap there affects images too.

## Verification

The implementation owns unit and renderer tests for AC1 through AC5 and records the gate results in the PR. The maintainer owns the Electron check for AC6 before acceptance. This note remains proposed until that check is complete.
