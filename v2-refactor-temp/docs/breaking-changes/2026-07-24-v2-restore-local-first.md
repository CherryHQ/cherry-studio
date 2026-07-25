---
title: V2 restore keeps local data and fills in missing items
category: changed
severity: notice
introduced_in_pr: "#17206"
date: 2026-07-24
---

## What changed

Settings → Data now has one Restore action; the archive determines whether the restore is database-only or full. Restore keeps existing non-empty local data and resources, fills empty fields, adds missing items, and discloses resources that will be skipped before restarting.

## Why this matters to the user

- Existing API keys and other non-empty local fields stay unchanged, while empty credential slots and missing models or records are filled from the backup.
- Existing files, knowledge bases, skills, and managed notes are not overwritten. The pre-restart summary identifies what will be restored and what will be skipped.
- Notes outside the app-managed data directory are not restored.
- Restored knowledge bases may briefly show incomplete search results on first launch while their index rebuilds in the background.

## What the user should do

Nothing for the common case — automatic. To replace a local resource with the backup's version, delete or rename the local one first. If an intentionally cleared database field is filled from the backup, clear it again after restoring.

## Notes for release manager

Combines the database merge behavior from #17206 with the full-resource planning and disclosure work from stacked PR #17340. Overwrite and rename strategies remain unavailable; conflicting local resources use skip semantics.
