---
title: Legacy referenced files adopt automatic cleanup policy
category: changed
severity: notice
introduced_in_pr: "#19287"
date: 2026-08-24
---

## What changed

Files that existed when a database completed its one-shot v2 migration and are still referenced by migrated Agent
Session attachments, chat messages, paintings, provider logos, or mini-app logos now use
`delete_when_unreferenced` instead of the conservative `manual` fallback.

## Why this matters to the user

Nothing is deleted while one of those references exists. If a user later removes the owning Agent Session message,
chat message, painting, provider logo, or mini-app logo, the normal cleanup sweep may reclaim the now-unreferenced
managed file. Previously, these legacy files were retained indefinitely.

## What the user should do

No action is required. Export or copy a managed file before removing its last owning item if it must be retained
independently.

## Notes for release manager

The migration uses each database's recorded `migration_v2_status.completedAt` boundary. It is restricted to rows
that existed when that one-shot migration completed, still have the `manual` default, and have a durable reference
in one of the five legacy migration cohorts. User-created manual files added later are unchanged.
