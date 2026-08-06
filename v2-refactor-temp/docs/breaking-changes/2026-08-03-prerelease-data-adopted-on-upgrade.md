---
title: Data from v2.0.0 alpha/beta installs is carried forward instead of silently rebuilt
category: data-migration
severity: breaking
introduced_in_pr: TBD
date: 2026-08-03
---

## What changed

Upgrading from a `v2.0.0-alpha.*` or `v2.0.0-beta.*` build now brings that
install's data into the current storage layout. Previously the pre-release
database was left behind at its old path, and the app quietly rebuilt a fresh one
from the v1 backup it still keeps for downgrades — so everything created since
the user installed a pre-release disappeared, with no error and no explanation.

Users who already upgraded to `rc.1`–`rc.4` and have been running on that rebuilt
database are asked, once, which of the two to keep. Neither is deleted: the one
not chosen is renamed alongside it.

## Why this matters to the user

Someone on a pre-release sees their sessions, notes, knowledge bases and settings
survive the upgrade rather than appearing to roll back to the day they left v1.

Someone who already upgraded gets a dialog on the next launch offering their
pre-release data or the data they have been using since. It appears once — after
that the choice is remembered.

If the upgrade cannot be completed the app stops with an explanation instead of
starting on rebuilt data, and both databases are left untouched on disk.

## What the user should do

Nothing, unless the choice dialog appears — then pick which set of data to
continue with. The other is kept on disk and support can recover it.

Anyone who quit at that dialog, or picked one and changed their mind, can ask
the in-app assistant to sort it out: the bundled `recover-preview-data` skill
walks through the same choice in their own language and records it for the next
launch. It never touches a database directly — the app is running on one by then
— so the swap still happens at startup.

## Notes for release manager

Targeted at **rc.5**.

Two limits worth stating in the release notes:

- **This does not recover data lost earlier.** Table-recreate migrations shipped
  throughout the alpha/beta window deleted child rows through `ON DELETE CASCADE`
  (fixed in #17569, which landed after every pre-release). Anyone who upgraded
  between alphas already lost rows at that point — most severely chat messages,
  for anyone who passed through `alpha.13 → alpha.14`. What survives is carried
  forward faithfully; what was already deleted cannot be brought back.
- **The two databases are not merged.** The choice is one or the other.

Both the adoption and the frozen alpha/beta migration chain it replays are
throwaway and should be deleted once pre-release installs are no longer
supported (`src/main/data/migration/v2/prerelease/`,
`migrations/sqlite-drizzle-legacy/`, and the `electron-builder.yml` entry).
