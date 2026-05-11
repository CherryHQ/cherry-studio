---
title: Web Search v2 runtime and settings changed
category: changed
severity: breaking
introduced_in_pr: TBD
date: 2026-05-08
---

## What changed

- Web Search no longer uses the renderer-side WebSearch service or assistant-specific Web Search provider selection. The chat toggle now uses the model's native Web Search when available; otherwise it injects built-in keyword search and URL fetch tools backed by the global Web Search defaults.
- Web Search no longer supports blacklist subscription feeds in v2. The manual Web Search blacklist remains available.
- Web Search cutoff compression no longer lets users choose between character and token units. The cutoff limit is always interpreted as a token limit.

## Why this matters to the user

- Users will configure Web Search providers globally in Settings instead of choosing a provider from the chat input quick panel. Missing API key or API host handling remains a follow-up UX decision.
- Users who configured blacklist subscription URLs in v1 will not see those feeds in v2, and their subscribed rules are not migrated into v2 preferences.
- Users who previously configured character-based cutoff compression may see different truncation lengths after migration. The Web Search settings page now shows only one cutoff length input and no unit selector.

## What the user should do

- Review Web Search Settings and configure the default keyword-search provider, URL-fetch provider, and any required API key or API host.
- Copy any required rules from subscription feeds into the manual Web Search blacklist.
- Review the Web Search cutoff length in Settings if search result context feels too short or too long.

## Notes for release manager

The previous `search_with_time` setting and Web Search provider health-check button are no longer part of the v2 Web Search runtime. Legacy `compressionConfig.cutoffUnit` values, including `char`, are not migrated into v2 preferences. Existing cutoff limits are preserved but treated as token limits. Missing provider configuration UX is intentionally not specified in this entry and should be decided separately.

This entry is related to `2026-05-06-web-search-provider-capabilities.md` and can be merged with it in the final v2 release note.
