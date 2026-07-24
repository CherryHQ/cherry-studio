---
title: Backup file extension renamed to .cherrybackup; default name simplified
category: changed
severity: notice
introduced_in_pr: #17206
date: 2026-07-23
---

## What changed

- Backup file extension: `.cbu` → `.cherrybackup` (branding; the archive is still a zip container holding `backup.sqlite` + file/knowledge/notes/skill blobs).
- Default backup filename: dropped the `cherry-studio-backup-` prefix → now just `<timestamp>.cherrybackup` (e.g. `20260723143000.cherrybackup`).
- Save / open dialog filters updated to `.cherrybackup`.

## Why this matters to the user

`.cbu` was not self-explanatory; `.cherrybackup` carries the Cherry brand and clearly reads as a backup. The filename prefix was redundant with the extension.

## What the user should do

New exports use `.cherrybackup`. Restore admission validates archive **content**, not the extension, so an older `.cbu` archive (pre-release internal) still restores when selected manually via the open dialog.

## Notes for release manager

RC gate: no shipped `.cbu` files exist yet (pre-release), so no compatibility shim or dual-extension filter is required. `admitArchive` validates content regardless of extension.
