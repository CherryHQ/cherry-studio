---
title: Full restore temporarily disabled; LITE restore unaffected
category: changed
severity: notice
introduced_in_pr: #17206
date: 2026-07-23
---

## What changed

The packaged "Full restore" control in Settings → Data is temporarily disabled (inert) while restore-side resource staging (files, knowledge bases, notes, skills) is unfinished. Database-only (LITE) restore remains available.

## Why this matters to the user

Users who open Backup / Restore will still see Restore for LITE archives, but Full restore is grayed out with a short explanation. Restoring a Full archive via a path that only promotes the database would leave attachments and other file content missing while looking successful — this gate prevents that silent degradation.

## What the user should do

Use LITE backup / restore for chat and settings until Full restore is re-enabled. If you only have a Full archive, re-export a LITE backup from a machine that still has live data, or wait for the Full restore re-enablement once resource staging ships.

## Notes for release manager

Short-term UI gate only (`isV2BackupRestoreFullReady()` → false). Flip back when FileStager + `p1-dbonly-fileentry-blob` land; remove or supersede this entry at that time.
