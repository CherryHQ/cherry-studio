---
title: v2 restore merges backups instead of replacing data (conflicts keep local values)
category: changed
severity: notice
introduced_in_pr: #17206
date: 2026-07-21
---

## What changed

Restoring a v2 `.cbu` backup now merges into the existing data instead of failing or
replacing it. Items missing locally (settings, providers and their API keys, model lists,
agent workspaces, tags, chat topics) are restored from the backup. Items that already exist
locally under the same identity are kept as-is — the backup's version of a conflicting item
is not applied. Links from restored items to something that exists in neither the backup
nor the local data are cleared (optional links) or the affected item is left out (required
links) rather than aborting the whole restore.

## Why this matters to the user

- On a fresh install, restoring a backup brings back settings, providers, API keys,
  workspaces, tags, and chats.
- On a machine that already has data, restore is additive: nothing local is overwritten or
  deleted. If the same provider/workspace/tag exists on both sides, the local version wins,
  including its credentials.

## What the user should do

Nothing — automatic. Users who want the backup's version of a conflicting item must remove
the local item before restoring (field-level merging of conflicting items is planned).

## Notes for release manager

Skipped conflicts and cleared/pruned links are currently only logged (main process log,
`merge completed with disclosed degradations`); an in-app disclosure after restart is a
planned follow-up. Overwrite/rename restore strategies remain unavailable.
