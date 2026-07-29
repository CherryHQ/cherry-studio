---
title: Skipping migration now discards data the failed run already migrated
category: data-migration
severity: notice
introduced_in_pr: '#17593'
date: 2026-07-29
---

## What changed

"Skip migration" is now also available on the migration **failure** screen, next
to Close App and Retry. Skipping no longer just marks migration finished: it
first clears everything the migration had already written to the new database
(including scheduled agent tasks) and starts v2 with default data. Original v1
data and any files already copied during the run are still left on disk.

## Why this matters to the user

Migration commits each step independently, so a run that failed halfway left
some data already imported. Previously, skipping at that point started v2 on top
of those partial rows — a mix of imported and default data with no way to tell
which was which. Now skipping always produces the same clean starting state,
whether it is chosen before migration begins, on a version-incompatible install,
or after a failure.

Users who skip after a partial failure will therefore no longer see the handful
of assistants, settings, or conversations that happened to be imported before
the error.

## What the user should do

Nothing — automatic. The confirmation dialog states up front that already
migrated records will be cleared, that v1 data is not deleted, and that
migration will not be prompted again. It keeps its 10-second countdown before
the confirm button becomes clickable, and can still be cancelled.

Users who would rather keep their data can choose Retry instead, or download v1
from the offer that appears after a second failure.

## Notes for release manager

The skip action still never deletes the v1 data directory or the files copied
during migration; those files simply have no reference in the v2 database. Worth
pairing with any future release note about reclaiming that disk space.
