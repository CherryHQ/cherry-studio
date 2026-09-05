---
title: Delete moves items to the Recycle Bin
category: changed
severity: notice
introduced_in_pr: '#16746'
date: 2026-07-04
---

## What changed

Delete no longer erases a topic, assistant, agent, agent session, painting, or internal file immediately. It moves the item to the Recycle Bin, where users can choose Restore or Delete permanently. Deleting an assistant or agent now keeps its related topics or sessions by default; the confirmation includes an optional checkbox to move those conversations to the Recycle Bin in the same operation. Recycle Bin contents are automatically cleaned up after a retention period (`data.trash.retention_days`, default 30 days; 0 = keep forever). Single messages and “clear messages” are **not** covered: they still erase immediately and are not recoverable, because deleting a message rewrites the surrounding conversation tree.

## Why this matters to the user

- An accidentally deleted item is recoverable from the Recycle Bin (Settings → Data → Recycle Bin) until the retention period expires.
- Restore does NOT bring back an item’s pinned state, tags, or — for assistants — group and prompt bindings. Those are removed at Delete time and must be re-applied manually. Messages and attachments always come back intact because Delete never touches them.
- Related conversations kept when deleting their owner remain available under the unlinked Assistant or Agent group. An unlinked agent session can be assigned to any active agent and continued without creating a new session.
- Restoring an assistant or agent also restores only the related topics or sessions moved to the Recycle Bin by that same owner deletion. Conversations deleted independently remain in the Recycle Bin and must be restored separately.
- Delete no longer frees disk space, and purging does not free it immediately either. “Empty Recycle Bin” starts reclaiming files right after it runs, but a large clear-out is drained across later background passes rather than all at once. Delete permanently removes only the database records; the attachments and generated images behind them are reclaimed by a background pass (on app start, then roughly every 30 minutes while idle, with about a one-hour grace window). Delete permanently for a file in the Files Recycle Bin is the one case that frees its blob straight away.
- Not everything goes to the Recycle Bin: single messages stay permanent, external file entries use Remove from Library (the file on disk is never touched), notes are unaffected (Recycle Bin support deferred), and knowledge bases are unaffected (deletion stays permanent).
- Items deleted **before** this release (assistants and anything already in the old Files Recycle Bin) keep their original deletion date and become subject to auto-purge for the first time. Any item deleted longer ago than the retention period (default 30 days) is purged by the next scheduled cleanup — it runs daily at 03:00, with a catch-up shortly after startup if a run was missed. More recently deleted items keep the remainder of their window. The retention setting only exists after upgrading, so to keep them, open Settings → Data → Recycle Bin right after the update and set retention to 0 before the next scheduled purge.

## What the user should do

For everyday use, nothing — it is automatic. Use Delete permanently only inside the Recycle Bin; use Restore before the retention period ends to recover an item. To keep deleted items forever, set the retention to 0.

One thing needs a decision right after upgrading: anything already in the Recycle Bin from an earlier version becomes subject to auto-purge for the first time, and whatever is older than the retention period is removed on the next scheduled run (daily at 03:00). The retention setting is new in this release, so it cannot be changed beforehand — if you want to keep those items, set retention to 0 on first launch and Restore what you need.

## Notes for release manager

Part of the Recycle Bin-only deletion rollout (RFC: v2-refactor-temp/docs/archive/rfc-recycle-bin.md). One aggregated release-note entry should cover all domains (topics, assistants, agents, sessions, paintings, files — not single messages); this fragment is the canonical one — sibling workstreams intentionally do not add their own to avoid duplicates. Out of scope by design decision: knowledge (excluded) and notes (deferred, see RFC §4.5).
