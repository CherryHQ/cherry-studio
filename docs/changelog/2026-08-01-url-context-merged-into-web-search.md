---
title: URL context toggle merged into the web search switch
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-01
---

## What changed

The separate "URL Context" button in the chat composer is gone. Fetching URLs
from the prompt (Gemini URL context / Anthropic web fetch / the client
`web_fetch` tool) is now enabled together with web search by the single web
search toggle.

## Why this matters to the user

Users who previously enabled URL context without web search will find that one
button missing; enabling web search now also lets supported models read URLs
from the prompt. Which side executes (provider-native vs Cherry's own tools)
is still chosen automatically per model/provider.

## What the user should do

Use the web search toggle. Nothing else — the old per-assistant URL-context
setting is dropped automatically.

## Notes for release manager

Can be merged with `2026-05-08-web-search-main-side-tools.md` and
`2026-05-06-web-search-provider-capabilities.md` into one web-tools item.
