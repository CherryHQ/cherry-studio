---
title: Existing backup destinations now store the v2 full-profile archive
category: changed
severity: breaking
introduced_in_pr: "#17499"
date: 2026-07-30
---

## What changed

The existing Local backup, WebDAV, Nutstore, and S3 screens remain available, but archive creation and restore now use the same full-profile v2 transaction as the manual Backup & restore section. The destination adapters retain their existing filenames, listing, rotation, and transport behavior; the bytes are a v2 archive even when an existing destination still names the file with a `.zip` suffix. The previous version 7 capture and restore-journal implementation is no longer active.

## Why this matters to the user

Backups sent to an existing destination now include the v2 portable database, managed-resource closure, degradation report, integrity checks, and whole-database restore behavior. A version 7 file created by an earlier 2.0 pre-release is not accepted by this restore path; keeping its old internal journal writer would cause the current preboot gate to set the request aside instead of restoring it.

## What the user should do

Create a fresh backup in each configured destination after updating. Keep older version 7 files only if they are needed with the exact pre-release build that created them; use a newly created destination backup for restore in the current build.

## Notes for release manager

This supersedes the final archive behavior described in `2026-07-24-backup-restored.md`, while retaining that change's enabled destination UI and transport settings. Fold this into `2026-07-28-backup-v2-replaces-whole-database.md`.
