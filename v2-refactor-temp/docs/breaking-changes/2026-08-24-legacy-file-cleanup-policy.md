---
title: Legacy referenced files adopt automatic cleanup policy
category: changed
severity: notice
introduced_in_pr: "#19287"
date: 2026-08-24
---

## What changed

Files that predate a database's one-shot v2 migration completion and are referenced by a migrated Agent Session
attachment, chat message, painting, provider logo, or mini-app logo now use `delete_when_unreferenced` instead of
the conservative `manual` fallback. The post-migration seeder may synthesize missing Agent Session attachment
references after that boundary, but only when both the source message and file also predate the boundary.

## Why this matters to the user

Nothing is deleted while one of those references exists. If a user later removes the owning Agent Session message,
chat message, painting, provider logo, or mini-app logo, the normal cleanup sweep may reclaim the now-unreferenced
managed file. Previously, these legacy files were retained indefinitely.

## What the user should do

No action is required. Export or copy a managed file before removing its last owning item if it must be retained
independently.

## Notes for release manager

The run-on-change backfill reads each database's recorded migration completion boundary through the v2 migration
domain's owner API. It inserts missing Agent Session attachment references only when their source message and file
predate that boundary, then updates only `manual` file rows that predate the boundary and have a matching durable
reference from one of the five legacy migration cohorts. User-created manual files and references added later are
unchanged.
