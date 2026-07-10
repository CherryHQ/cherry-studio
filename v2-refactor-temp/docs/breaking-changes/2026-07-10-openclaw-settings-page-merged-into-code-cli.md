---
title: Standalone OpenClaw settings page removed (merged into the Code CLI page)
category: moved
severity: notice
introduced_in_pr: #16491
date: 2026-07-10
---

## What changed

The dedicated OpenClaw settings page is gone. OpenClaw now appears as one of the tools on the Code CLI page, where its provider/model selection, gateway start/stop, and dashboard entry live alongside the other CLI tools.

## Why this matters to the user

Users who managed OpenClaw from its own settings page will not find it there anymore; everything moved to Code CLI → OpenClaw. The old page's step-by-step install progress display was not carried over — installation now uses the same install button and coarse progress indication as the other CLI tools.

## What the user should do

Use the Code CLI page and select OpenClaw. No data migration is needed; existing OpenClaw configs keep working.

## Notes for release manager

Merge with the custom-terminal-path removal entry (same PR) if aggregating per-page.
