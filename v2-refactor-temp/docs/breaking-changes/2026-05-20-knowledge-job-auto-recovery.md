---
title: Unfinished knowledge indexing automatically resumes after restart
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-05-20
---

## What changed

Knowledge base indexing now persists every in-flight task to disk and resumes it automatically after a process restart or crash. Previously, indexing that was interrupted by quit/crash stayed stuck in "processing" forever and required the user to manually re-trigger reindex; that no longer happens.

## Why this matters to the user

- Indexing that was running when the app exited (graceful quit, crash, OS shutdown) is picked up again ~1 minute after the next launch — no user action needed.
- A few side effects are visible:
  - Per-base concurrency moves from a shared 5-slot global pool to 5 slots **per base** with a 50-slot global cap, so importing into several bases in parallel finishes faster.
  - Transient embedding failures are now retried up to 3 times with exponential backoff before the item shows as "failed".
  - Each `prepare-root` (directory/sitemap scan) job has a 10-minute wall-clock cap, and each `index-leaf` (single file/url/note embed) job has a 5-minute wall-clock cap. Very large single files served by a slow embedding endpoint may now hit the leaf timeout where before they would run indefinitely.
- The `processing` status may briefly persist after force-quit; it self-heals once the recovery pass finishes after the next launch.

## What the user should do

Nothing — automatic. If a previously failed indexing item is still stuck after the next launch + ~1 minute, run "Reindex" from the item's context menu as before.

## Notes for release manager

- Recovery is gated by `JobManager.onAllReady`, which fires 60 s after the lifecycle reaches `WhenReady`. On a cold start this means indexing resumes ~60 s into the session, not at process start.
- The 5-minute per-leaf timeout is a deliberate change from "no timeout". If telemetry shows large-document users hitting it, raise `defaultTimeoutMs` on `indexLeafJobHandler` rather than rolling this back.
- v1 → v2 migrated knowledge bases that had in-flight indexing at upgrade time are mapped to `idle` / `failed` by `KnowledgeMigrator` (unchanged from prior v2 behavior). Users must manually reindex those — auto-recovery covers v2 → v2 restarts only.
