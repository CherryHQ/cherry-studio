---
title: Browser screenshots return readable regions and full-page tiles
category: changed
severity: notice
introduced_in_pr: 20134
date: 2026-09-10
---

## What changed

Browser screenshots can target a snapshot ref. Full-page capture returns multiple bounded images
with region metadata and a continuation cursor instead of one oversized image.

## Why this matters to the user

Long pages no longer produce excessively tall images that vision providers reject.
Agents can inspect a relevant area without automatically scrolling the user's page.

## What the user should do

Nothing — automatic for built-in Agents. External MCP consumers should process all image blocks
and use `nextCursor` when they need the remaining page tiles.

## Notes for release manager

Offscreen lazy content must be loaded explicitly. Existing image attachments and request-side
image serialization are unchanged.
