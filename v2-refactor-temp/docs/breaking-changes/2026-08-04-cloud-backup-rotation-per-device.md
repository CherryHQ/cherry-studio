---
title: Cloud backup rotation now only deletes this device's backups
category: changed
severity: breaking
introduced_in_pr: "#17499"
date: 2026-08-04
---

## What changed

"Max backups" now counts and deletes only the backups the current device wrote. Backups from another computer sharing the same folder are listed and can be restored, but are never deleted to make room. Backups saved under a name the user typed are also never deleted automatically.

Nutstore previously counted every `cherry-studio*.zip` in its folder against the limit regardless of which device wrote it, so two computers syncing to one Nutstore folder deleted each other's backups.

Old backups are also no longer removed before the new one is uploaded — a failed upload leaves the existing backups untouched. Previously, with "Max backups" set to 1, Nutstore deleted every existing backup first and a failed upload left none.

The per-destination "Skip file data" switch is gone from all four screens. It had no effect: v2 has one backup, which always includes managed files.

## Why this matters to the user

Anyone syncing two machines to one WebDAV, Nutstore, S3, or shared folder will stop losing the other machine's backups. The trade-off is that the folder can now hold more files than "Max backups" suggests — the limit applies per device, and hand-named backups sit outside it entirely.

Users who had turned "Skip file data" on were not getting smaller backups; nothing about their backups changes, the switch simply stops implying otherwise.

## What the user should do

Nothing — automatic. Backups made before this change keep their old names and are not recognized as belonging to any device, so they are never auto-deleted; remove them by hand from the backup manager if the folder needs tidying.

## Notes for release manager

Worth calling out for multi-device users specifically — the old Nutstore behaviour silently destroyed data and there was no way to notice until a restore was needed. Folds under `2026-07-28-backup-v2-replaces-whole-database.md` at release time.
