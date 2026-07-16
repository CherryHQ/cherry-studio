---
title: "V2 cannot restore from v1 backup archives"
category: data-migration
severity: breaking
introduced_in_pr: "#16683"
date: 2026-07-03
---

## What changed

V2's restore only reads the new v2 backup format (a `manifest` plus `backup.sqlite` plus `files`/`knowledge` resources). v1's legacy `.backup` archives (IndexedDB / LocalStorage / optional Data export produced by the old backup manager) are **not** readable by v2 restore. v1 data reaches v2 only through the one-way migration assistant (`src/main/data/migration/v2/`), never by importing a v1 `.backup` file.

## Why this matters to the user

After upgrading to v2, a `.backup` file created under v1 can no longer be used to restore data. The app does not offer a "restore from v1 backup" action. The user must rely on the migration assistant (run automatically on first launch) to carry their current v1 data into v2.

## What the user should do

Before upgrading, either (a) restore any v1 `.backup` files into the v1 app so their data becomes "current" and is picked up by the migration assistant, or (b) confirm the migration assistant has already carried your data into v2, then create a fresh v2-format backup. Keep v1 `.backup` files for archival only — they cannot be read by v2.

## Notes for release manager

This entry records an architectural contract fixed in the backup v2 refactor (the 14-domain contributor stack is v2-format-only; v1 has no read path in v2). The user-facing restore action lands in the C-import phase (ImportOrchestrator + RestoreSafetyManager), but the contract is already binding on the data model. If C-import's restore UI lands in a later PR, re-point `introduced_in_pr` to that PR if it better reflects "when the user first notices."
