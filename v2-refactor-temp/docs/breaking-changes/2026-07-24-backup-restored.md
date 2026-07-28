---
title: Backup and restore are available during the v2 transition
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-24
---

## What changed

The existing local, WebDAV, Nutstore, and S3 backup settings are enabled again. Newly created direct archives use format version 7 and include the SQLite database, `cache.json`, the retained v1 data directories, and Cherry Studio's private `.claude` runtime state.

## Why this matters to the user

Backups created by the v2 app now contain its primary business database, persisted main-process cache, and the runtime files required to resume app-owned Claude sessions. Restore validates and durably stages the complete archive, then relaunches into the preboot promotion gate; a failed validation or promotion keeps the previous database and file resources intact.

## What the user should do

Create a fresh backup after upgrading. Every Cherry Studio v1 backup format — version 6 direct ZIPs, metadata-less version 1-5 ZIPs, and `.bak` files — is rejected by v2 restore because it cannot provide a complete v2 data set.

## Notes for release manager

The "skip file backup" option still excludes the `Data` directory, but it does not exclude SQLite, `cache.json`, or app-owned `.claude` state. The generated `.claude/skills` mirror is excluded and rebuilt by the app; external `~/.claude` and `CLAUDE_CONFIG_DIR` locations are never included.
