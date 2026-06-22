---
title: Prompt settings page and auto topic switch setting removed
category: removed
severity: notice
introduced_in_pr: #16269
date: 2026-06-22
---

## What changed

The standalone Prompt Settings page is no longer available under Settings. The legacy "Auto switch to topic" assistant setting is also removed from the v2 preference model.

## Why this matters to the user

Old message navigation buttons that point to the removed prompt settings route will no longer open that deleted page. Users will also no longer see or configure the old automatic topic-switch setting in Settings.

## What the user should do

Nothing - the v2 settings design removes these entries intentionally.

## Notes for release manager

Merge with other settings-carve notes if the final release notes group removed settings pages together.
