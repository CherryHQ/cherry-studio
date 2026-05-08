---
title: Web Search now runs through main-side tools
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-05-08
---

## What changed

Web Search no longer uses the renderer-side WebSearch service or assistant-specific Web Search provider selection. The chat toggle now uses the model's native Web Search when available; otherwise it injects built-in keyword search and URL fetch tools backed by the global Web Search defaults.

## Why this matters to the user

Users will configure Web Search providers globally in Settings instead of choosing a provider from the chat input quick panel. When a required API key or API host is missing, the UI prompts the user to open the provider settings before enabling or selecting that provider.

## What the user should do

Review Web Search Settings and configure the default keyword-search provider and URL-fetch provider. Add the required API key or API host when prompted.

## Notes for release manager

The previous `search_with_time` setting and Web Search provider health-check button are no longer part of the v2 Web Search runtime. This entry is related to `2026-05-06-web-search-provider-capabilities.md` and can be merged with it in the final v2 release note.
