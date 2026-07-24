---
title: Restore becomes a single entry; conflicting resources keep the local version and are disclosed
category: changed
severity: notice
introduced_in_pr: #17340
date: 2026-07-24
---

## What changed

Settings → Data no longer offers separate "Restore" / "Full restore" actions. There is one Restore button; the app reads the backup archive's own manifest to decide whether it is a database-only (LITE) or full backup and restores accordingly.

During a full restore, resources that already exist locally (files, knowledge bases, skills, notes) are never overwritten: the local version is kept, and the pre-restart dialog lists what **will be restored** and what **will be skipped** with the reason. Notes stored in a custom notes directory outside the app's data directory are not restored (only managed notes are); knowledge bases rebuild their search index automatically after the restart that completes the restore.

## Why this matters to the user

- Users who previously chose between two restore buttons now see just one; nothing to choose, the archive decides.
- After confirming a restore of a full backup, a summary dialog appears before the restart showing the planned outcome; skipped items are not silently dropped — each is listed with its reason, and the local copy stays untouched.
- Restored knowledge bases may briefly show incomplete search results on first launch while their index rebuilds in the background.

## What the user should do

Nothing — automatic. To replace a local file/knowledge base/skill/note with the backup's version, delete or rename the local one first, then restore again.

## Notes for release manager

Supersedes `2026-07-23-full-restore-temporarily-disabled.md` (the temporary Full-restore gate this change removes) — merge or drop that entry at release prep. The disclosure dialog uses future tense deliberately: promotion applies at next boot and can still expire the whole batch if a conflict appears in the gap.
