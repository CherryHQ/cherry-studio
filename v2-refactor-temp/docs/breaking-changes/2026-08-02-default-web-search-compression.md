---
title: Web search results are compressed by default
category: changed
severity: notice
introduced_in_pr: "#17752"
date: 2026-08-02
---

## What changed

Built-in web search now limits fetched result content to 10,000 estimated tokens by default instead of sending unlimited page content to the model.

## Why this matters to the user

Web-enabled Agent requests are less likely to exceed a model's context window after fetching several large pages. Existing V2 databases and V1 configurations that still match the previous default are upgraded automatically; customized compression settings are preserved.

## What the user should do

Nothing — automatic. Users who prefer full, uncompressed page content can select **None** in Web Search compression settings.

## Notes for release manager

The old default-shaped state is indistinguishable from a user who explicitly selected **None** without first changing the cutoff limit, so that exact state is upgraded once.
