---
title: Cache cleanup is now selective and can remove old-version leftovers
category: data-migration
severity: notice
introduced_in_pr: "#17377"
date: 2026-07-24
---

## What changed

The cache cleanup confirmation has become a four-option dialog covering regular
cache, website and mini-app data, old-version data, and unfinished legacy
restore staging. Each option shows its estimated removable size, and only
regular cache is selected by default.

The old-version option becomes available only after the v2 migration completes.
It includes the legacy `{userData}/config.json`, schema-verified database
leftovers, the old knowledge-base rollback source, old Memory data that did not
migrate to v2, and the legacy `~/.cherrystudio/install` CLI directory.

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

Targets use explicit application-owned paths. Ambiguous databases and shared
configuration are schema/content validated, while the dedicated legacy
`config.json` and restore paths are removed in full. The renderer removes only
explicit v1 localStorage keys and the `CherryStudio` IndexedDB database; current
v2 cache keys and data stores are retained.
