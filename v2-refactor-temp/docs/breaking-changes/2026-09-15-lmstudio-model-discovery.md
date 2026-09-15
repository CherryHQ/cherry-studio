---
title: LM Studio lists downloaded models with automatic loading disabled
category: changed
severity: notice
introduced_in_pr: '#20346'
date: '2026-09-15'
---

## What changed

For LM Studio 0.4.0 and newer, Sync models can discover downloaded models even when Just-in-Time loading is disabled. Model names now use LM Studio's display names when available.

## Why this matters to the user

Downloaded models no longer need to be loaded into memory before they appear in the list. Embedding classification and model context limits remain available.

## What the user should do

Sync models again to discover missing models. If Just-in-Time loading is disabled, load a model in LM Studio before using it for inference.

## Notes for release manager

Older LM Studio versions fall back to the OpenAI-compatible model list, which can still depend on Just-in-Time loading. This change does not establish the cause of the reported Failed to pull models error.
