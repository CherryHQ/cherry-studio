---
title: Backup and restore support full and slim version 7 archives
category: changed
severity: breaking
introduced_in_pr: "#17555"
date: 2026-07-24
---

## What changed

The existing local, WebDAV, Nutstore, and S3 backup settings are enabled again. Newly created direct archives continue to use format version 7 and can be either full or slim: full archives contain `Data`, `IndexedDB`, `Local Storage`, and `cache.json`, while slim archives contain only `Data/cherrystudio.sqlite` and `cache.json`. `metadata.json` records the selected resource layout, and no duplicate top-level database or `.claude` resource is created.

## Why this matters to the user

Full backups preserve the supported application data and browser storage, except for SQLite's transient WAL/SHM sidecars and active restore-journal control files. Slim backups reduce archive size by preserving only the SQLite database and cache; restoring one leaves the existing non-database `Data` contents, `IndexedDB`, and `Local Storage` unchanged. Both layouts route SQLite through the crash-safe promotion gate, and a failed validation or promotion keeps the previous database and file resources intact.

## What the user should do

Create a fresh backup after upgrading, and choose a full backup when browser storage and all supported `Data` contents must be preserved. Use a slim backup when only the SQLite database and cache are required. Cherry Studio v1 backup formats — version 6 direct ZIPs, metadata-less version 1-5 ZIPs, and `.bak` files — remain rejected.

## Notes for release manager

The `resources` flags distinguish full and slim layouts without increasing the archive version. Earlier version 7 archives with standalone SQLite and `.claude` resources remain restorable. The backup checkpoints SQLite before copying, so committed data is sealed in `cherrystudio.sqlite`; SQLite recreates the excluded `cherrystudio.sqlite-wal` and `cherrystudio.sqlite-shm` sidecars after restore.
