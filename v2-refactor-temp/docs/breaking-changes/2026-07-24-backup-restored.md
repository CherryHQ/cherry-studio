---
title: Backup and restore use complete Data directory archives
category: changed
severity: breaking
introduced_in_pr: "#17555"
date: 2026-07-24
---

## What changed

The existing local, WebDAV, Nutstore, and S3 backup settings are enabled again. Newly created direct archives use format version 7 and contain the `Data` directory, `IndexedDB`, `Local Storage`, and `cache.json`. `metadata.json` is included only as the archive format manifest. SQLite and app-owned `.claude` files inside `Data` are copied as ordinary `Data` contents; the transient `cherrystudio.sqlite-wal` and `cherrystudio.sqlite-shm` sidecars are excluded, and no second top-level database or `.claude` resource is created.

## Why this matters to the user

Backups now preserve the `Data` tree except for SQLite's transient WAL/SHM sidecars. Restore validates and durably stages the archive, routes the SQLite file through the crash-safe database promotion gate, and restores the remaining `Data` contents and top-level resources. A failed validation or promotion keeps the previous database and file resources intact.

## What the user should do

Create a fresh backup after upgrading. Cherry Studio v1 backup formats — version 6 direct ZIPs, metadata-less version 1-5 ZIPs, and `.bak` files — remain rejected. Earlier version 7 archives with standalone SQLite and `.claude` resources remain restorable.

## Notes for release manager

Version 7 copies every entry under `Data` except `cherrystudio.sqlite-wal` and `cherrystudio.sqlite-shm`. The backup checkpoints SQLite before copying, so committed data is already sealed in `cherrystudio.sqlite`; SQLite recreates both sidecars after restore. During restore, the database and restore-journal control files are handled separately from ordinary `Data` entries so they cannot overlap the promotion journal that is actively applying the restore.
