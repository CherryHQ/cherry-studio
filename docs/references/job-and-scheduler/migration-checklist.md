---
description: Per-handler checklist for migrating existing background services to JobManager — recovery, queues, tests, data moves
sources:
  - src/main/core/job
---

# Migration Checklist

Use this checklist when migrating an existing background-work owner to JobManager. Each migration is a separate project — this doc is the per-handler discipline applied within each.

## Per-handler

- [ ] Choose `recovery` strategy:
  - `abandon` — fire-and-forget (heartbeats, notifications)
  - `retry` — "must complete" (ingestion, indexing, model sync)
  - `singleton` — "at most one active per type" (init, periodic refresh)
- [ ] Set `defaultQueue` if per-resource serialization is needed (e.g. `base.${baseId}` for per-base writes)
- [ ] Set `defaultConcurrency` based on resource budget (vector store / GPU / network)
- [ ] Configure `defaultRetryPolicy` if retries are valuable
- [ ] Set `defaultTimeoutMs` if the handler can be long-running
- [ ] Implement `execute`:
  - Respect `ctx.signal.aborted` in every loop body and every `await`
  - Use `ctx.patchMetadata` for cross-restart state hand-off (e.g., remote task IDs)
  - Use `ctx.reportProgress(percent, detail)` for renderer-visible progress
  - Do NOT use `while (true)` — always `while (!ctx.signal.aborted)`
- [ ] Implement `onMissed` if business needs catch-up observability or breaker
- [ ] Implement `onSettled` if business needs terminal-state reactions — the event carries typed `input`, `parentId`, and final `metadata` (no `getById` reverse lookup needed); for a failure-rate breaker query
      `jobService.listRecentTerminalByScheduleId(scheduleId, N)` for the truth, do NOT build a separate counter table
- [ ] Add JobRegistry type binding via TypeScript declaration merging
- [ ] Register handler in the owning service's `onInit`

## Persisted-data migration (only when existing rows must move)

- [ ] Map existing rows → `jobTable` / `jobScheduleTable` rows
- [ ] If the SQLite schema changes, update `src/main/data/db/schemas/` and append a generated migration with `pnpm db:migrations:generate`
- [ ] If v1 source data must enter v2, update the owning migrator under `src/main/data/migration/v2/migrators/`; do not add a runtime v1 fallback
- [ ] Add a `v2-refactor-temp/docs/breaking-changes/` entry if user-visible behavior changes (e.g., agent task: per-attempt log → single row per enqueue)
- [ ] Delete or thin-facade the legacy service (keep IPC entry points; redirect to JobManager)

## Validation per handler

- [ ] Smoke test: enqueue → terminal happy path
- [ ] Restart test: spawn jobs, `kill -9`, verify recovery acts per `recovery` strategy
- [ ] Concurrency test: assert per-queue concurrency cap is respected (and per-resource Layer 3 lock for write-heavy handlers)
- [ ] Cancel test: cancel during run, verify `cancelled` terminal status and handler observed `ctx.signal.aborted`
- [ ] Catch-up test (if scheduled): freeze time past nextRun, verify `onMissed` event and (for `after-startup`) the make-up job

## Cross-cutting verification (each phase)

- [ ] `pnpm lint` and the focused JobManager/owning-domain tests pass; use full `pnpm test` only when the affected surface is broad
- [ ] DataApi read models (if added) are declared in the owning `src/shared/data/api/schemas/<domain>.ts` file and implemented in the main handler map; `paths.ts` / `types.ts` derive their unions
- [ ] cacheSchemas entries (if any new cache keys) registered
- [ ] Migration summary added to PR description (what migrated, what stayed)
