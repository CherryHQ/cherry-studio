---
title: Context compression failures now show a warning
category: changed
severity: notice
introduced_in_pr: '#20398'
date: 2026-09-11
---

## What changed

Context compression now shows a warning in the conversation when the selected model cannot be used or summarization fails. Saved non-chat models are rejected, and the conversation continues without compression.

## Why this matters to the user

Compression can no longer silently stop because of an unsupported model or a provider error.

## What the user should do

If a warning appears, check the compression model and its provider configuration in context management settings.

## Notes for release manager

Fixes #20249.
