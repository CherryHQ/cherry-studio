---
title: Backup restore replaces the full database
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-28
---

## What changed

Backup v2 Lite exports and restores the complete Cherry Studio database. Restoring it replaces the current database rather than merging selected records. An active RC1 version-7 restore is completed automatically during upgrade, but version-7 archives are not accepted by the Lite `.cherrybackup` UI.

## Why this matters to the user

The restore confirmation restarts the app and replaces current database content. Local managed files are intentionally left untouched, so file-backed content may be unavailable on another device.

## What the user should do

Keep a Lite archive somewhere safe, review the destructive restore confirmation, and export a new Lite archive after upgrading; use a full migration feature only when it is released separately.

## Notes for release manager

Credentials are included as profile data but integrations that execute programs or access the network remain disabled after restore.
