---
title: Automatic backup runs in the background and reports what it wrote
category: changed
severity: notice
introduced_in_pr: "#17868"
date: 2026-08-05
---

## What changed

Automatic backup now runs in the main process, from app start, for every destination it is turned on for. It used to be a timer inside the app window, which started over whenever that window reloaded.

"Last backup" times survive a restart now, and they mean a backup that was actually written: they are read from the scheduled runs rather than kept in the window, and a run that failed or found the destination unconfigured is reported as such instead.

Two things go with the old scheduler: the spinner that appeared next to a destination while its scheduled backup ran, and the error dialog that interrupted whatever the user was doing after repeated failures. A scheduled backup no longer involves a window; a failed one is reported next to the destination the next time Settings is opened. Backups started by hand still show their progress.

## Why this matters to the user

The status next to each destination now answers the question it is read for: when a scheduled backup last reached that destination, and whether the latest one failed. A window reload no longer resets it.

The first backup after updating can happen within a few minutes of startup rather than on the exact old interval boundary: a schedule whose turn was missed while the app was closed runs shortly after the next launch instead of waiting a full interval.

## What the user should do

Nothing — automatic. After restoring a backup, automatic backup is off for every destination until it is turned back on.

## Notes for release manager

Pairs with `2026-08-04-cloud-backup-rotation-per-device.md`: backups running reliably is what makes the rotation fix matter, so they should be described together.
