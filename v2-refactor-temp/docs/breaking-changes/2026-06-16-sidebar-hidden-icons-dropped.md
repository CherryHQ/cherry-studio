---
title: Hidden sidebar icons are no longer migrated separately
category: data-migration
severity: notice
introduced_in_pr: #16066
date: 2026-06-16
---

## What changed

Cherry Studio v2 migrates the legacy visible sidebar icon list into the new sidebar favorites list. The separate legacy hidden icon list is no longer preserved as its own setting.

## Why this matters to the user

Users who customized hidden sidebar icons in v1 may see the v2 sidebar rebuilt from their visible favorites instead of preserving a separate hidden list.

## What the user should do

Review the sidebar favorites after upgrading and adjust the visible items if needed.

## Notes for release manager

This belongs with other v2 sidebar preference migration notes.
