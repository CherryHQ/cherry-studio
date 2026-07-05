---
title: Deleting items moves them to the trash instead of erasing them
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-04
---

## What changed

Deleting a topic, assistant, agent, agent session, painting, or internal file no longer erases it immediately — the item is archived to the trash, where it can be restored or permanently deleted. Trash contents are automatically cleaned up after a retention period (`data.trash.retention_days`, default 30 days; 0 = keep forever). Deleted single messages and "clear messages" are also kept internally for the retention window, but they do not appear in the trash and cannot be individually restored (the conversation tree may have already changed).

## Why this matters to the user

- An accidentally deleted item is recoverable from the trash (Settings → Data → Recently Deleted) until the retention period expires.
- Restoring an item does NOT bring back its pinned state or tags — those are removed at delete time and must be re-applied manually.
- Data of deleted items stays on disk until it is purged, so "delete" no longer immediately frees space; use permanent delete / empty trash for that.
- Not everything goes to the trash: external file entries are unaffected (deleting one only removes it from the app's list, the file on disk is never touched), notes are unaffected (trash support deferred), and knowledge bases are unaffected (deletion stays permanent).

## What the user should do

Nothing — automatic. To bypass the trash, use "Delete permanently"; to recover, restore from the trash before the retention period ends. To keep deleted items forever, set the trash retention to 0.

## Notes for release manager

Part of the archive-instead-of-delete rollout (RFC: v2-refactor-temp/docs/archive/rfc-archive.md). One aggregated release-note entry should cover all domains (topics, messages, assistants, agents, sessions, paintings, files); this fragment is the canonical one — sibling workstreams intentionally do not add their own to avoid duplicates. Out of scope by design decision: knowledge (excluded) and notes (deferred, see RFC §4.5).
