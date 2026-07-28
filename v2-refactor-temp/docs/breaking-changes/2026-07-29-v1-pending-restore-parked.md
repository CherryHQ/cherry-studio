---
title: A restore confirmed in a 2.0 pre-release is not completed after updating
category: data-migration
severity: notice
introduced_in_pr: #17499
date: 2026-07-29
---

## What changed

Only 2.0 pre-release builds (`2.0.0-beta.1` through `beta.3` and the nightlies after them) ever wrote the old restore record; stable 1.x never did. If a user confirmed a restore in one of those builds and updated before the app relaunched to carry it out, the new build does not carry it out either. It sets the leftover record aside under a new name (`.parked-v1` next to it), boots normally on the existing database, and deletes nothing — the record, the staged copy of the backup, and any database the pre-release had already moved aside all stay on disk.

## Why this matters to the user

Only visible in a narrow window: the app was closed between confirming a restore in a 2.0 pre-release and that restore actually running, and the next launch is a newer build. The user sees their data as it was before the restore — nothing is lost, but the restore they asked for simply did not happen, and no error is shown. The one case that does show something: if the database is also missing from its expected place, the app refuses to start rather than open an empty one, and says so.

## What the user should do

Nothing, if the restore is no longer wanted — the leftover files can be deleted by hand at any time, or left alone. If it is still wanted, either restore the same `.cherrybackup` file again in the current build (the simple route), or reinstall the exact pre-release that staged it and rename `restore-journal.json.parked-v1` back to `restore-journal.json` in the app's `Data` folder, which lets that build finish the original restore. A 1.x `.zip` backup cannot be selected by the current restore UI at all.

## Notes for release manager

Not worth a headline entry on its own; fold into `2026-07-28-backup-v2-replaces-whole-database.md` — it is the narrow update-window case of the same rewrite, and it affects pre-release testers only, never users coming from stable 1.x. Do not describe this as data loss: nothing is deleted, only skipped.
