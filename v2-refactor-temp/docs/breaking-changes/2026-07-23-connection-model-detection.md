---
title: Provider connection fields can discover models automatically
category: changed
severity: notice
introduced_in_pr: 17361
date: 2026-07-23
---

## What changed

When a provider has no local models, Cherry Studio now checks its model-list endpoint after the user leaves a valid API key or API host field. Adding, replacing, or enabling an API key also triggers the same discovery.

If the user switches to another app tab while discovery is still running or discovered models are waiting to be added, Cherry Studio asks whether to stay and add models or leave without adding them.

## Why this matters to the user

Users configuring a new provider can add all discovered models or choose specific models without manually starting a separate model pull. This only discovers model identifiers; it does not verify that each model can complete requests.

## What the user should do

Choose **Add all**, **Add selectively**, or **Later** when the discovery notice appears. If prompted while switching tabs, stay to finish adding models or explicitly leave without adding them.
