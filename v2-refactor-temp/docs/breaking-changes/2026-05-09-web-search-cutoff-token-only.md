---
title: Web Search cutoff compression now uses tokens only
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-05-09
---

## What changed

Web Search cutoff compression no longer lets users choose between character and token units. The cutoff limit is always interpreted as a token limit.

## Why this matters to the user

Users who previously configured character-based cutoff compression may see different truncation lengths after migration. The Web Search settings page now shows only one cutoff length input and no unit selector.

## What the user should do

Review the Web Search cutoff length in Settings if search result context feels too short or too long.

## Notes for release manager

Legacy `compressionConfig.cutoffUnit` values, including `char`, are not migrated into v2 preferences. Existing cutoff limits are preserved but treated as token limits.
