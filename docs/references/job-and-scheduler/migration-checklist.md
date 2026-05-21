# Migration Checklist (Phase 2-4)

Use this checklist when migrating an existing service (KnowledgeRuntime / FileProcessing / agent task / heartbeat) to the unified JobManager. Each phase is a separate project — this doc is the per-handler discipline applied within each.

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
- [ ] Implement `onSettled` if business needs failure-rate breaker — query
      `jobService.listRecentTerminalByScheduleId(scheduleId, N)` for the truth, do NOT build a separate counter table
- [ ] Add JobRegistry type binding via TypeScript declaration merging
- [ ] Register handler in the owning service's `onInit`

## Data migration (per business)

- [ ] Map existing rows → `jobTable` / `jobScheduleTable` rows
- [ ] Run migration via `v2-refactor-temp/tools/data-classify` flow
- [ ] Update v2 migrators in `src/main/data/migration/v2/migrators/` for clean-restart safety
- [ ] Add a `v2-refactor-temp/docs/breaking-changes/` entry if user-visible behavior changes (e.g., agent task: per-attempt log → single row per enqueue)
- [ ] Delete or thin-facade the legacy service (keep IPC entry points; redirect to JobManager)

## Validation per handler

- [ ] Smoke test: enqueue → terminal happy path
- [ ] Restart test: spawn jobs, `kill -9`, verify recovery acts per `recovery` strategy
- [ ] Concurrency test: assert per-queue concurrency cap is respected (and per-resource Layer 3 lock for write-heavy handlers)
- [ ] Cancel test: cancel during run, verify `cancelled` terminal status and handler observed `ctx.signal.aborted`
- [ ] Catch-up test (if scheduled): freeze time past nextRun, verify `onMissed` event and (for `after-startup`) the make-up job

## Cross-cutting verification (each phase)

- [ ] `pnpm lint` + `pnpm test` + `pnpm format` clean
- [ ] DataApi paths (if added) registered in `apiPaths.ts` / `apiTypes.ts`
- [ ] cacheSchemas entries (if any new cache keys) registered
- [ ] No commits to legacy services unless they're being deleted/refactored
- [ ] Phase summary added to PR description (what migrated, what stayed)
