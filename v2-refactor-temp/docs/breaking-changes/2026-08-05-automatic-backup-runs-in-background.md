---
title: Automatic backup no longer needs the settings page open
category: changed
severity: notice
introduced_in_pr: "#17499"
date: 2026-08-05
---

## What changed

Automatic backup now runs on its own, from app start, for every destination it is turned on for. It used to start only if the user opened that destination's settings page during the session — closing the app before visiting Settings meant no scheduled backup ran at all.

"Last backup" times survive a restart now, because they are read from the schedule rather than kept in the open window.

Two things go with the old scheduler: the spinner that appeared next to a destination while its scheduled backup ran, and the error dialog that interrupted whatever the user was doing after repeated failures. A scheduled backup no longer involves a window; a failed one is reported next to the destination the next time Settings is opened. Backups started by hand still show their progress.

## Why this matters to the user

Anyone who turned automatic backup on and assumed it was running was probably wrong before this, and is right now. Expect backups to actually appear at the configured destination on the configured interval.

The first backup after updating can happen within a few minutes of startup rather than on the exact old interval boundary: a schedule whose turn was missed while the app was closed runs shortly after the next launch instead of waiting a full interval.

## What the user should do

Nothing — automatic. Worth checking the interval on each destination once after updating, since it now takes effect whether or not Settings is ever opened.

## Notes for release manager

Pairs with `2026-08-04-cloud-backup-rotation-per-device.md`: backups running reliably is what makes the rotation fix matter, so they should be described together.
