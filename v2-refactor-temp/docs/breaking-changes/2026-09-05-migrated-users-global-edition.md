---
title: Migrated users keep global-edition features
category: data-migration
severity: notice
introduced_in_pr: TBD
date: 2026-09-05
---

## What changed

Users who successfully migrate v1 data now receive global-edition features regardless of the installed package.
The identity follows their database through restarts, backups and data-directory relocation. Fresh installations
continue to use their package edition.

## Why this matters to the user

Installing the China package no longer hides global-only providers and mini apps from migrated users.
Cherry Cloud uses the global service for these profiles. Existing China Cloud sessions are not sent to that service.

## What the user should do

Nothing — automatic. Users with an existing China Cloud session may need to sign in to the global service.

## Notes for release manager

Old completed installations are classified once using valid v1 records in version.log. Cleared history or a
database-only restore may prevent recognition; historical explicit skips cannot be distinguished from migration.
New explicit skips do not grant global identity. Package application IDs and automatic-update channels are unchanged.
Verify both package editions, migration failure/retry/skip, restart, first-frame UI behavior, and Cloud session isolation.
