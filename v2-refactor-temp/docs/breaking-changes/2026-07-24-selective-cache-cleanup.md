---
title: Cache cleanup is now selective and can remove verified v1 leftovers
category: data-migration
severity: notice
introduced_in_pr: "TBD"
date: 2026-07-24
---

## What changed

The cache cleanup confirmation has become a four-option dialog covering regular
cache, website and mini-app data, verified v1 legacy data, and unfinished
legacy restore staging. Each option shows its estimated removable size, and
only regular cache is selected by default.

The v1 option becomes available only after the v2 migration completes. It
includes verified legacy application data, the old knowledge-base rollback
source, old Memory data that did not migrate to v2, and the legacy
`~/.cherrystudio/install` CLI directory.

New trace history is stored under `{userData}/Runtime/trace`. The regular-cache
option also counts and removes trace files left in the previous
`~/.cherrystudio/trace` location; old trace history is not migrated automatically.

## Why this matters to the user

Users can reclaim v1 disk space without also clearing website sessions. Website
data may contain sign-in state, while deleting v1 data or legacy restore staging
is irreversible.

## What the user should do

Review the descriptions and selected size before clearing. Keep the v1 and
legacy restore options unchecked if the old rollback source or a pending legacy
backup restore is still needed.

## Notes for release manager

File targets are allowlisted and schema-validated. The renderer removes only
explicit v1 localStorage keys and the `CherryStudio` IndexedDB database; current
v2 cache keys and data stores are retained.
