# Tasks — rebrand-002-branding-module

- [x] Implement per plan.md
- [x] Verify acceptance criteria
- [x] pnpm lint

## Deviations from plan (approved)

**Module location.** Plan said `src/shared/branding/`. Created
`src/shared/utils/branding.ts` instead: `docs/references/architecture/shared-layer.md:56`
states "a new capability **never** earns a new top-level dir" — the top level
(`ai`/`data`/`ipc`/`types`/`utils`) is a closed set and constants decompose by shape
into `utils`. This also placed it beside the pre-existing
`APP_NAME = 'Cherry Studio'` in `utils/constants.ts`.

**`CHERRY_HOME_DIRNAME` not migrated (user chose option 1).**
`src/main/core/paths/constants.ts` documents "No business-module dependencies
(no @shared / @main / business code)" — it loads before `app.whenReady()` for
`LoggerService` and `BootConfigService`. Importing `@shared` there would violate a
boot-path invariant. The literal stays duplicated, with reciprocal comments in both
files; `rebrand-003` owns the filesystem move.

## Evidence

- `src/shared/utils/branding.ts` — **zero imports** (pure leaf module)
- Call sites migrated: `src/main/utils/http.ts` (`HTTP-Referer`/`X-Title`),
  `src/main/features/apiGateway/openapiDocs.ts` (2 API titles)
- 4 test files repointed at the constants instead of brand literals, so they assert
  the contract ("attribution headers are sent") rather than pinning a brand:
  `providerAttributionHeaders`, `mcpTransport`, `agentSessionWarmup`, `ApiProviders`
- 11 inline snapshots regenerated; verified the diff was **only** the two attribution
  headers, no behavior change
- `pnpm test:main` → **1031 files / 16381 tests passed**, 0 failed
- `pnpm lint` → exit 0 (4 typecheck projects, 76011 translations, format clean)

## Note

`src/main/services/file/tree/__tests__/builder.test.ts` timed out once under full-suite
load but passes in isolation both with and without these changes — flaky watcher
timing, not a regression. It passed in the final full run.
