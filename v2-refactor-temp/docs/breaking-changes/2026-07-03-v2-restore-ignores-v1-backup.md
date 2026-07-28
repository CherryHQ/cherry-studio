---
title: "V2 cannot restore v1 backup archives"
category: data-migration
severity: breaking
introduced_in_pr: "#17206"
date: 2026-07-03
---

## What changed

V2 restore accepts the new `.cherrybackup` format but cannot import legacy `.backup` archives created by v1. Existing v1 data reaches v2 through the one-way migration assistant instead.

## Why this matters to the user

After upgrading to v2, a `.backup` file created under v1 can no longer be used to restore data. The migration assistant runs on first launch and carries the current v1 data into v2, but it does not read archived `.backup` files.

## What the user should do

Before upgrading, either (a) restore any v1 `.backup` files into the v1 app so their data becomes "current" and is picked up by the migration assistant, or (b) confirm the migration assistant has already carried your data into v2, then create a fresh v2-format backup. Keep v1 `.backup` files for archival only — they cannot be read by v2.

## Notes for release manager

The format boundary originated in #16683; #17206 is the user-facing restore PR. The pre-release `.cbu` extension was never shipped and does not need a separate release-note entry.
