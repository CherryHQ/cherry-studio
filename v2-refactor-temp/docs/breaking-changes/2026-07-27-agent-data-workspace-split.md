---
title: Agent identity and memory move outside Session workspaces
category: data-migration
severity: notice
introduced_in_pr: "#17450"
date: 2026-07-27
---

## What changed

Agent identity files (`SOUL.md`, `USER.md`) and persistent memory now live with
the Agent instead of inside a Session workspace. App-managed Sessions receive
separate system workspaces. During v1 migration, ordinary files from the former
shared managed workspace move to the most recently used Session; older managed
Sessions start with empty workspaces.

## Why this matters to the user

Identity and memory now follow the Agent consistently across all of its
Sessions, while files created in one app-managed Session no longer appear
automatically in another. Older migrated Sessions do not receive duplicate
snapshots of the single workspace they shared in v1.

External user-selected workspaces remain in place and continue to be used
directly.

## What the user should do

Nothing — migration is automatic. If an older Session needs files that were
moved to the most recently used Session workspace, copy or select those files
explicitly after upgrading.

## Notes for release manager

v1 did not store a historical workspace snapshot per Session, so copying its
last shared state into every migrated Session would invent duplicate history.
The migration preserves one copy under the most recently used Session and
documents the intentional change in historical Session context.
