---
title: Custom providers' Responses endpoint uses a spec-neutral adapter
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-12
---

## What changed

Custom (user-created) providers with an `openai-responses` endpoint now default to the `open-responses` adapter, a spec-neutral Responses dialect, instead of the first-party OpenAI adapter.

## Why this matters to the user

A custom provider pointing at the real OpenAI API no longer sends OpenAI-specific request options: `store: false`, `include: reasoning.encrypted_content`, and `serviceTier`. Third-party Responses endpoints (DeepSeek, Bailian, Ark, Fireworks, MiMo, OpenCode, TokenHub, Hugging Face) are unaffected functionally — they get a dialect that no longer sends OpenAI-only fields they ignore or reject.

## What the user should do

Use the OpenAI preset provider for first-party features (encrypted reasoning replay, service tier, storage opt-out). Custom providers targeting third-party Responses endpoints need no action.
