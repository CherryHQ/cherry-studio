---
title: API gateway token counting is accurate and media-aware
category: changed
severity: notice
introduced_in_pr: "#17195"
date: 2026-07-20
---

## What changed

The gateway's token-count endpoints now estimate against the converted request the downstream provider actually receives, instead of a rough text-only walk of the raw body:

- `POST /v1/messages/count_tokens` (Anthropic dialect): counts with per-dialect text tokenizers (real o200k BPE for OpenAI-style targets), pixel-based image costs, per-dialect audio/video rates, and the tool definitions as they reach the wire. When the target is an Anthropic-dialect endpoint, the provider's own authoritative `count_tokens` is preferred, with a fast local fallback.
- Gemini `POST /v1beta/models/{model}:countTokens`: requests carrying media (`inlineData`/`fileData`) now return HTTP 200 with a media-inclusive estimate. Previously they were rejected with 400 `INVALID_ARGUMENT`, forcing the client to fall back to its own local guess.

## Why this matters to the user

Agent/CLI sessions through the gateway (e.g. Claude Code, gemini-cli) rely on these endpoints for context tracking. With accurate counts — including images and other media — auto-compaction triggers at the right time instead of overflowing the provider's context limit (issue #17079) or compacting far too early.

## What the user should do

Nothing — automatic. No settings change.

## Notes for release manager

Forwarding tool-result images as real image content (relocation into user file parts) landed on `main` separately and is not part of this change; this PR's user-visible change is the counting. Clients that depended on the Gemini 400-on-media behavior now receive a 200 estimate instead.
