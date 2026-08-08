---
title: API gateway sends tool-result images as images, not base64 text
category: changed
severity: notice
introduced_in_pr: N/A
date: 2026-07-20
---

## What changed

When an Anthropic-format request routed through Cherry's API gateway (`/v1/messages`) contains an image nested inside a `tool_result`, the gateway now forwards it as real image content. Vision-capable models on Anthropic/Gemini-dialect endpoints receive the actual image; all other cases — non-vision models, and any OpenAI-style endpoint (whose wire format cannot carry media inside tool messages, vision-capable or not) — receive a short "[image attachment omitted]" note instead. Previously the gateway flattened such images into a giant base64 **text** string that the model could not read and that inflated the request by hundreds of thousands of tokens.

## Why this matters to the user

Agent/CLI sessions (e.g. Claude Code) that return images from tools — screenshots, generated images, multimodal MCP tool results — now work correctly through the gateway: vision models can see the image, and context usage / `count_tokens` reflect the real footprint, so auto-compaction triggers at the right time instead of overflowing the provider's context limit (issue #17079).

## What the user should do

Nothing — automatic. No settings change.

## Notes for release manager

Text-only tool results are unchanged (still plain text). Related: the same PR made the gateway's `/v1/messages/count_tokens` estimate the converted representation (per-dialect tokenizer + pixel-based image cost, Anthropic remote count when available).
