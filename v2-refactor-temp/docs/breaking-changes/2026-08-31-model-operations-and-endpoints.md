---
title: Custom models can declare multiple operations and endpoints
category: changed
severity: notice
introduced_in_pr: "#17383"
date: 2026-08-31
---

## What changed

Custom models now select one or more operations—text generation, image generation, embedding, and rerank—instead of one model type. Endpoint choices are limited to protocols configured by the provider and compatible with at least one selected operation.

## Why this matters to the user

A single model can now be used for multiple supported operations without losing capabilities when edited. Removing an operation also removes incompatible endpoint selections and a preference pinned to one of those endpoints.

## What the user should do

Nothing for existing models—the migration preserves embedding, rerank, media, and multi-operation models and classifies other existing models as text generation. When adding a custom model, select at least one operation and a compatible endpoint.
