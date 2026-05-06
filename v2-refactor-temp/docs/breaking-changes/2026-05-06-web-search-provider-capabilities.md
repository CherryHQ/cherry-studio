---
title: Web Search provider defaults are split by capability
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-05-06
---

## What changed

Web Search now has separate default provider settings for keyword search and URL content fetching. Jina is shown as one provider, `Jina`, with both capabilities instead of a separate `Jina Reader` entry.

## Why this matters to the user

Users configuring Web Search will see two default-provider selectors in Settings: one for normal search and one for fetching URLs. Existing v2 development data that referenced the removed `jina-reader` provider id or the single Web Search default provider will not be preserved by this refactor.

## What the user should do

Select defaults for both Web Search capabilities in Settings. Users who rely on Jina should configure the single Jina provider and choose it where needed.

## Notes for release manager

This is a v2 development breaking change. Per the architecture decision, no compatibility migration is included for the old v2-only `chat.web_search.default_provider` key or `jina-reader` provider id.
