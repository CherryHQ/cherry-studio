---
title: Backup restore replaces the full database
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-28
---

## What changed

Backup v2 Lite exports and restores the complete Cherry Studio database. Restoring it replaces the current database rather than merging selected records.

## Why this matters to the user

The restore confirmation restarts the app and replaces current database content. Local managed files are intentionally left untouched, so file-backed content may be unavailable on another device.

## What the user should do

Keep a Lite archive somewhere safe, review the destructive restore confirmation, and use a full migration feature only when it is released separately.

## Notes for release manager

Credentials are included as profile data but integrations that execute programs or access the network remain disabled after restore.
