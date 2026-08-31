---
title: Model-native web tools are used by default
category: changed
severity: notice
introduced_in_pr: "#19784"
date: 2026-08-31
---

## What changed

Web search and URL fetching now use model-native capabilities by default, with an automatic fallback to configured services when the model does not support them or they are unavailable. During upgrade, an existing preference for configured services is reset once to the new model-native default.

## Why this matters to the user

Users who previously preferred configured search services may see supported models handle web search and URL fetching directly after upgrading. Configured services remain available as an automatic fallback.

## What the user should do

Nothing — automatic. To prefer configured services again, enable **Prefer configured search services** under Settings → Web Search.

## Notes for release manager

The upgrade reset is one-time only. A user who enables the setting afterward keeps that choice on later launches.
