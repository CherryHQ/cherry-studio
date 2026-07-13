---
title: Export-to-phone temporarily removed from Data settings
category: removed
severity: notice
introduced_in_pr: TBD
date: 2026-07-13
---

## What changed

The "Export to phone" section in Settings → Data (LAN transfer to a mobile device, and export-as-file for mobile import) is gone. The feature is taken offline until the mobile side is ready; it will return in a later release.

## Why this matters to the user

Users who previously transferred data to the mobile app from this settings section will no longer find the entry. Regular backup/restore in the same page is unaffected.

## What the user should do

TBD — the feature will be re-launched once mobile-side development is complete. Until then, use the regular backup file flow if a manual copy is needed.

## Notes for release manager

UI-only removal: the underlying LAN transfer service, IPC channels, and backup-file generation are kept dormant in the codebase for the relaunch. If the feature ships again before v2.0.0, drop this entry.
