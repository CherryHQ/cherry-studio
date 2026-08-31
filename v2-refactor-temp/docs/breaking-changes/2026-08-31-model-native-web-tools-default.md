---
title: Model-native web tools are used by default
category: changed
severity: notice
introduced_in_pr: "#19784"
date: 2026-08-31
---

## What changed

Web search and URL fetching now use model-native capabilities by default, with an automatic fallback to configured services when the model does not support them or they are unavailable. Search and URL fetching now have independent source-priority preferences; an existing shared preference is not copied to either new setting during upgrade.

## Why this matters to the user

Users who previously preferred configured services may see supported models handle web search and URL fetching directly after upgrading. Configured services remain available as automatic fallbacks, and each capability can be changed independently.

## What the user should do

Nothing — automatic. To change the priority, open Settings → Web Search, expand **Advanced Settings** under Search or URL Fetch, and enable the corresponding configured-service preference.

## Notes for release manager

Both new preferences default to model-native-first. Choices saved after upgrade persist independently.
