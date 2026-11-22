# Agent Note: Convert scanned PDFs with the default document processor

Status: proposed

English | [中文](2026-11-22-agent-scanned-pdf-conversion.zh.md)

## Problem

Agent `to_markdown` uses AnyDoc for local conversion. A scanned PDF can fail with `needsOcr`, and a mixed PDF can yield incomplete text when a page lacks a text layer. Cherry Studio already lets users select a default document processor. Agents need the selected document processor to convert PDFs that require OCR.

## Proposal

Use AnyDoc for ordinary documents and PDFs with text on every page. For a PDF with a textless page, or one for which AnyDoc returns `needsOcr`, send the complete PDF through the user's current default **Document processing** processor. Use the existing `FileProcessingService` task contract for processor selection, execution, cancellation, and results. The **OCR** setting applies to image recognition. If the document processor is unset or unavailable, tell the user what to configure. Surface other conversion errors directly.

Use the existing default for both local and remote document processing. A remote processor receives the document directly when selected. The settings page describes use by knowledge bases and Agents.

Only files resolved by the tool's existing workspace, agent-data and session-attachment checks are eligible. Wait for the selected task's result and return the tool's private Markdown file receipt. Propagate cancellation to the conversion task.

## Alternatives considered

- Call local PaddleOCR directly: bypasses the user's processor selection and the shared task handling.
- Ask for a separate grant or per-file confirmation: adds an action to the existing processor choice.
- Apply the default document processor to every conversion: would add latency and potentially incur charges for documents AnyDoc can convert locally.

## Acceptance criteria

- AC1 — Ordinary documents and PDFs with text on every page convert locally without a configured document processor. (verification: unit; owner: Agent integration)
- AC2 — A scanned or mixed PDF uses the entire file and honors the current document processor preference. An unset or unavailable processor produces actionable guidance. (verification: unit and Electron; owner: File Processing integration)
- AC3 — A configured remote default converts successive PDFs using the same existing processor selection. (verification: unit and Electron; owner: Agent integration)
- AC4 — A successful conversion returns the existing private Markdown receipt. Cancelling the tool cancels the conversion task, and an unauthorized path cannot reach either processor. (verification: unit; owner: Agent integration)

## Risks

A remote default receives eligible Agent files. Verify repeated conversions in Electron with a controlled endpoint.
