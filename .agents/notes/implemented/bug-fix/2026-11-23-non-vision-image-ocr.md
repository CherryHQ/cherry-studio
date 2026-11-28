# Agent Note: OCR fallback keeps non-vision chat sendable

Status: implemented

English | [中文](2026-11-23-non-vision-image-ocr.zh.md)

## Problem

Attachment routing rejected the entire provider request when a non-vision model's image fallback returned empty text or failed. Routing retried OCR across retained history, so an older image could prevent a later text-only turn from reaching the provider. Issues #24143 and #24989 record this failure.

## Decision

Keep the OCR attempt on first-party images in the latest user message. Include any extracted text using the existing attachment budget. An empty result or processor failure becomes a model-visible note naming the image. Earlier images receive an image-capability note without invoking OCR. Cancellation still propagates. Vision-capable models still receive native images.

## Alternatives considered

- Skipping OCR for every image would remove useful text from the current prompt.
- Retrying OCR on earlier images could add repeated work to an unrelated turn.

## Consequences

A model without image input receives an explicit description of the limitation and can answer the rest of the prompt. Historical image text is unavailable through automatic OCR on later turns. Stored messages and files keep their original attachments.

## Verification

- Regression — Attachment routing tests exercise empty and failed OCR, cancellation, successful OCR, and a text-only follow-up with an older image.
