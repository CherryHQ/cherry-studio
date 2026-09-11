---
title: Unreadable images now stop before requests to models without Vision enabled
category: changed
severity: breaking
introduced_in_pr: TBD
date: 2026-08-18
---

## What changed

When an image is attached to a model without Vision enabled, Cherry Studio still tries OCR first. If OCR is unavailable, fails, or extracts no readable text, the turn now stops with an actionable error instead of sending the native image to the provider.

## Why this matters to the user

Text-only model requests can no longer fail downstream with an opaque provider error caused by an unsupported image. Gateway-backed models that accept images must now declare that capability in the model's input modalities.

## What the user should do

For a gateway-backed model that accepts images, open Provider Settings and enable Vision in that model's input modalities. Otherwise, configure OCR, choose another vision-capable model, or remove the image.

## Notes for release manager

This supersedes the native-image fallback described in `2026-07-30-chat-image-ocr-native-fallback.md`. Describe only the final capability-driven behavior in release notes.
