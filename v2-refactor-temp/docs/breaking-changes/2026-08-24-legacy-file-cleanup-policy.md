---
title: Legacy referenced files adopt automatic cleanup policy
category: changed
severity: notice
introduced_in_pr: "#19287"
date: 2026-08-24
---

## What changed

Files that existed when a database completed its one-shot v2 migration and are referenced by a migrated Agent
Session attachment, chat message, painting, provider logo, or mini-app logo now use `delete_when_unreferenced`
instead of the conservative `manual` fallback. Agent Session attachment references are synthesized by the
post-migration seeder after that completion boundary; they are not part of the one-shot migration snapshot.

## Why this matters to the user

Nothing is deleted while one of those references exists. If a user later removes the owning Agent Session message,
chat message, painting, provider logo, or mini-app logo, the normal cleanup sweep may reclaim the now-unreferenced
managed file. Previously, these legacy files were retained indefinitely.

## What the user should do

No action is required. Export or copy a managed file before removing its last owning item if it must be retained
independently.

## Notes for release manager

The run-on-change backfill reads each database's recorded migration completion boundary through the v2 migration
domain's owner API. It is restricted to file rows and durable references that both existed when that one-shot
migration completed. Both must belong to one of the five legacy migration cohorts, and the file must still have the
`manual` default. User-created manual files and references added later are unchanged.
