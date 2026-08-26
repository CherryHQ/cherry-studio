---
title: Deleting items moves them to the trash instead of erasing them
category: changed
severity: notice
introduced_in_pr: '#16746'
date: 2026-07-04
---

## What changed

Deleting a topic, assistant, agent, agent session, painting, or internal file no longer erases it immediately — the item is archived to the trash, where it can be restored or permanently deleted. Trash contents are automatically cleaned up after a retention period (`data.trash.retention_days`, default 30 days; 0 = keep forever). Single messages and "clear messages" are **not** covered: they still erase immediately and are not recoverable, because deleting a message rewrites the surrounding conversation tree.

## Why this matters to the user

- An accidentally deleted item is recoverable from the trash (Settings → Data → Recently Deleted) until the retention period expires.
- Restoring an item does NOT bring back its pinned state, its tags, or — for assistants — its group and its prompt bindings. Those are removed at delete time and must be re-applied manually. Messages and attachments always come back intact: archiving never touches them.
- What comes back with an item differs by type: restoring an agent also restores the sessions that were archived with it, but restoring an assistant does NOT restore the conversations archived alongside it — those stay in the trash and have to be restored individually.
- Deleting no longer frees disk space, and purging does not free it immediately either. "Empty trash" starts reclaiming files right after it runs, but a large clear-out is drained across later background passes rather than all at once; a single "Delete permanently" removes only the database records, and the attachments and generated images behind them are reclaimed by a background pass (on app start, then roughly every 30 minutes while idle, with about a one-hour grace window). Permanently deleting a file from the Files trash is the one case that frees its blob straight away.
- Not everything goes to the trash: single messages stay permanent, external file entries are unaffected (deleting one only removes it from the app's list, the file on disk is never touched), notes are unaffected (trash support deferred), and knowledge bases are unaffected (deletion stays permanent).
- Items deleted **before** this release (assistants, and anything already sitting in the old Files-page trash) keep their original deletion date and become subject to auto-purge for the first time. Any of them deleted longer ago than the retention period (default 30 days) are removed permanently by the next scheduled purge — it runs daily at 03:00, with a catch-up shortly after startup if a run was missed. More recently deleted ones keep the remainder of their window. The retention setting only exists after upgrading, so to keep them, open Settings → Data → Recently Deleted right after the update and set retention to 0 before the next scheduled purge.

## What the user should do

For everyday use, nothing — it is automatic. To bypass the trash, use "Delete permanently"; to recover, restore from the trash before the retention period ends. To keep deleted items forever, set the trash retention to 0.

One thing needs a decision right after upgrading: anything already sitting in the trash from an earlier version becomes subject to auto-purge for the first time, and whatever is older than the retention period is removed on the next scheduled run (daily at 03:00). The retention setting is new in this release, so it cannot be changed beforehand — if you want to keep that old trash, set retention to 0 on first launch and restore what you need.

## Notes for release manager

Part of the archive-instead-of-delete rollout (RFC: v2-refactor-temp/docs/archive/rfc-archive.md). One aggregated release-note entry should cover all domains (topics, assistants, agents, sessions, paintings, files — not single messages); this fragment is the canonical one — sibling workstreams intentionally do not add their own to avoid duplicates. Out of scope by design decision: knowledge (excluded) and notes (deferred, see RFC §4.5).
