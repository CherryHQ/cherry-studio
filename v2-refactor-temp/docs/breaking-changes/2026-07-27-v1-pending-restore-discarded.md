---
title: A restore staged in v1 but not yet completed is discarded on upgrade
category: data-migration
severity: notice
introduced_in_pr: #17499
date: 2026-07-27
---

## What changed

Backup v2 replaced the v1 restore promotion outright. If a user staged a v1 restore (confirmed it, so the app was about to relaunch and swap the database in) and then upgraded to v2 before that relaunch happened, v2 does not carry out the v1 restore. It quarantines the leftover v1 journal, clears its staging tree, and boots normally on the existing database.

## Why this matters to the user

Only visible in a narrow window: the app was closed between confirming a v1 restore and the restore actually running, and the next launch is a v2 build. The user sees their data as it was before the restore — nothing is lost, but the restore they asked for simply did not happen, and no error is shown.

## What the user should do

A v1 backup file cannot be restored by v2. If the restore is still needed, run it in a v1 build first, let that restore complete, then upgrade and create a new v2 `.cherrybackup` file. Keep the original v1 backup until the new backup has been verified.

## Notes for release manager

Not worth a headline entry on its own; fold into the general "backup and restore were rebuilt in v2" note if one exists. The v1 journal is kept on disk as `restore-journal.json.corrupt-<epoch>` for support diagnosis.
