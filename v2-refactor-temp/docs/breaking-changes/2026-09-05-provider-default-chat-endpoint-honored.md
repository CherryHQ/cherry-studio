---
title: A provider's default chat endpoint now decides the route
category: changed
severity: notice
introduced_in_pr: "#17383"
date: 2026-09-05
---

## What changed

Picking a **default chat endpoint** in a provider's settings now actually routes requests, for every model that declares that protocol. Until now the setting was recorded and then ignored: a model listing several protocols was always called with whichever one its catalog entry listed first, so a provider set to OpenAI-Response still sent chat-completions.

The per-model **Preferred Endpoint** still wins over it — a choice made for one model is more specific than one made for the whole provider. Models that do not declare the provider's default keep their own protocol, and non-chat work (embedding, rerank, image, audio, video) is unaffected: a chat default can never capture an embedding request.

## Why this matters to the user

Providers that serve several chat protocols — doubao, dashscope, deepseek, azure-openai, and the aggregators — will send requests to the endpoint their settings page has been showing all along. Endpoint choice changes the request format, response parsing, reasoning dialect, and which provider-native tools (built-in web search, URL context) are available, so a model may start answering with a different feature set than before, matching the setting rather than the catalog.

## What the user should do

Nothing is required. Open Settings → Providers and check the default chat endpoint if the previous behavior was the one you wanted; a per-model exception goes in the model drawer's Preferred Endpoint.

## Notes for release manager

Fixes #19688. The same rung is the subject of PR #19286, which fixes it independently and defers the per-model preference to this PR — the two need to land against one shared resolution order, documented in `docs/references/ai/provider-resolution.md`.
