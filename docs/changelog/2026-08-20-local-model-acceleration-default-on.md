---
title: Local embedding and OCR use hardware acceleration by default
category: changed
severity: notice
introduced_in_pr: "#19055"
date: 2026-08-20
---

## What changed

Settings → Dependencies → Local models has a "hardware acceleration" switch that is now **on by default**. Local embedding and OCR inference run on DirectML (Windows x64/arm64) or CoreML (macOS arm64) instead of CPU. Linux and Intel Mac are unchanged — they have no supported provider, so the switch stays hidden and inference stays on CPU.

## Why this matters to the user

Local embedding and OCR are noticeably faster on a fresh install without the user having to find the switch first. If a provider is missing or fails at runtime, the app falls back to CPU on its own — the failed request is retried once on CPU and that worker stays on CPU afterwards, so the visible effect is a slower request, not an error.

## What the user should do

Nothing — automatic. Users who hit driver-specific problems can turn the switch off in Settings → Dependencies → Local models.

## Notes for release manager

Only new installs pick this up: `PreferenceSeeder` inserts missing keys and never overwrites existing rows, so anyone who already ran a v2 build keeps their stored `false` and has to enable it by hand. Worth phrasing the release note as "new installs" rather than a blanket "now enabled".
