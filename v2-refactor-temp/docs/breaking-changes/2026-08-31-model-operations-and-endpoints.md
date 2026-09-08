---
title: Custom models can declare multiple operations and endpoints
category: changed
severity: notice
introduced_in_pr: "#17383"
date: 2026-08-31
---

## What changed

Custom models now select one or more operations—text generation, image generation, embedding, and rerank—instead of one model type. Endpoint choices are limited to protocols configured by the provider and compatible with at least one selected operation.

Adding comma-separated model IDs is atomic: if any model fails validation or creation, none of the models in that submission are added. The form keeps the full input available for correction and retry.

## Why this matters to the user

A single model can now be used for multiple supported operations without losing capabilities when edited. Removing an operation also removes incompatible endpoint selections and a preference pinned to one of those endpoints.

## What the user should do

Nothing for existing models—the migration preserves stored operations and recovers missing operations from the custom model's declared endpoints. Without endpoint information, audio-only-to-text models become transcription models; other models default to text generation. Preset-backed models continue to inherit their operations from the registry. When adding a custom model, select at least one operation and a compatible endpoint.
