---
title: Chat images with no OCR text are now sent to the model as-is
category: changed
severity: notice
introduced_in_pr: 17637
date: 2026-07-30
---

## What changed

When an image is attached in Home Chat and addressed to a model without declared image-recognition support, Cherry Studio still runs OCR first — but if OCR finds no text, is not configured, or fails, the image is now forwarded to the provider as a base64-backed native image instead of being replaced with a `[could not read this file]` note.

## Why this matters to the user

Photos, charts, and other images without recognizable text are no longer silently reduced to an unreadable-file note on "non-vision" models. Models whose vision capability is under-declared in their metadata now receive the actual image; providers that truly cannot process images may ignore or reject it according to their own behavior.

## What the user should do

Nothing. Images with recognizable text keep the existing OCR-to-text behavior; configuring an `image_to_text` processor still improves results for text-heavy images on non-vision models.

## Notes for release manager

Only the empty-OCR / OCR-unavailable path changed; OCR-with-text, explicit OCR features (translation workflow), and the `read_file` tool are unchanged.
