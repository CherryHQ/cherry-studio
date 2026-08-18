---
title: Deleting items moves them to the trash instead of erasing them
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-07-04
---

## What changed

Deleting a topic, assistant, agent, agent session, painting, or internal file no longer erases it immediately — the item is archived to the trash, where it can be restored or permanently deleted. Trash contents are automatically cleaned up after a retention period (`data.trash.retention_days`, default 30 days; 0 = keep forever). Single messages and "clear messages" are **not** covered: they still erase immediately and are not recoverable, because deleting a message rewrites the surrounding conversation tree.

## Why this matters to the user

- An accidentally deleted item is recoverable from the trash (Settings → Data → Recently Deleted) until the retention period expires.
- Restoring an item does NOT bring back its pinned state or tags — those are removed at delete time and must be re-applied manually.
- Data of deleted items stays on disk until it is purged, so "delete" no longer immediately frees space; use permanent delete / empty trash for that.
- Not everything goes to the trash: single messages stay permanent, external file entries are unaffected (deleting one only removes it from the app's list, the file on disk is never touched), notes are unaffected (trash support deferred), and knowledge bases are unaffected (deletion stays permanent).
- Items deleted **before** this release (assistants, and anything already sitting in the old Files-page trash) carry their original deletion date, so they are already past the 30-day window and the first purge after upgrading removes them permanently.

## What the user should do

Nothing — automatic. To bypass the trash, use "Delete permanently"; to recover, restore from the trash before the retention period ends. To keep deleted items forever, set the trash retention to 0.

## Notes for release manager

Part of the archive-instead-of-delete rollout (RFC: v2-refactor-temp/docs/archive/rfc-archive.md). One aggregated release-note entry should cover all domains (topics, assistants, agents, sessions, paintings, files — not single messages); this fragment is the canonical one — sibling workstreams intentionally do not add their own to avoid duplicates. Out of scope by design decision: knowledge (excluded) and notes (deferred, see RFC §4.5).
