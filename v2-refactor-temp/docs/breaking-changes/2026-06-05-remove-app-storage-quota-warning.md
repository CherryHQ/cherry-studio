---
title: App storage quota warning removed (disk-space warning retained)
category: removed
severity: notice
introduced_in_pr: #TBD
date: 2026-06-05
---

## What changed

The browser storage-quota warning (triggered when `navigator.storage` usage reached ≥95%) has
been removed. The data-directory low-disk warning (free space < 1 GiB) is retained — it now runs
in the main process and auto-dismisses once space is freed.

## Why this matters to the user

In v1 the storage-quota warning watched the renderer's browser storage (redux-persist and
friends). Since v2 keeps business data in the main-process SQLite database, that quota no longer
reflects where data is actually stored, so the warning was misleading and is gone. Users will no
longer see an "app storage quota" warning, but they are still warned when the disk that holds
their data is genuinely running out of space.

## What the user should do

Nothing — automatic. Disk protection is retained and improved: the low-space notification now
appears reliably and clears itself once space is freed.

## Notes for release manager

The removed piece is the `checkAppStorageQuota` check only. The retained disk-space check moved
from a renderer-side timer to the main-process `StorageMonitorService` (capacity-adaptive polling,
main window only, auto-dismiss); the warning threshold is unchanged at free space < 1 GiB.
Set `introduced_in_pr` to the actual PR number on merge.
