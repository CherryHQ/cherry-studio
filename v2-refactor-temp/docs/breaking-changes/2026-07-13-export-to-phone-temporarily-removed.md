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

UI-only removal: the underlying LAN transfer service and its IPC channels are kept dormant in the codebase for the relaunch. If the feature ships again before v2.0.0, drop this entry.

**The archive generator is gone; the relaunch needs a new one.** It produced the v1 layout — a `data.json` beside an empty `Data/` — which nothing in v2 can restore: admission expects `manifest.json` + `backup.sqlite` + `resources/`. Its renderer-side payload producer was a matching v1 shape (`{ version: 5, localStorage }`), which in v2 holds an emoji-picker history and a favicon cache and none of the user's data. Keeping either would have preserved a pipeline whose output no version of this app can read.

What survives is everything the relaunch actually needs: the transfer service, its binary protocol and handshake, the scan/connect/send channels, and the temp-file cleanup (now `deleteTransferFile` on `LanTransferService`, with its path-traversal tests). What has to be built is the archive to send, and the answer is the v2 one `BackupService.export()` already produces — note that `handlers/fileTransfer.ts` currently accepts `.zip` only.
