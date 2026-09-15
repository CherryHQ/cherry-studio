# System Doctor

Runs health checks in main and publishes progress + the final report on the shared cache key
`doctor.state`. Product spec (Feishu): System Doctor PRD.

## Layout

| File | Role |
|------|------|
| `@shared/types/doctor.ts` | **Source of truth.** `DOCTOR_CHECK_CATALOG` declares every check (domain, tier, fixes, detail variants, prerequisites); all other types derive from it |
| `@shared/ipc/schemas/doctor.ts` | Routes `diagnostics.doctor.run` / `.cancel` / `.fix` |
| `types.ts` | `DoctorCheckDefinition<Id>` — what a check implementation must provide |
| `checks/<domain>.ts` | One file per domain, `defineDoctorCheck({...})` per check |
| `registry.ts` | `{ [Id in DoctorCheckId]: DoctorCheckDefinition<Id> }` — exhaustive and closed |
| `engine.ts` | Pure runner: prerequisite layering, timeout, cancel, skip cascade, lane concurrency |
| `DoctorService.ts` | Lifecycle service: run / cancel / fix, publishes `doctor.state` |

## Adding a check (three edits, all compile-checked)

1. **Catalog** — add the id to `DOCTOR_CHECK_IDS` and an entry to `DOCTOR_CHECK_CATALOG`:
   ```ts
   'network-proxy-applied': {
     domain: 'network',            // must equal the id prefix
     tier: 'live',                 // quick ≤ 1 s local | live = network | deep = opt-in
     fixes: [],                    // or [{ id: 'restart', risk: 'low', reversible: true, relaunch: false }]
     details: ['custom_without_url'],
     requires: []                  // other check ids; on their fail/error this check is skipped
   }
   ```
2. **Implementation** — `checks/network.ts`:
   ```ts
   export const proxyApplied = defineDoctorCheck({
     id: 'network-proxy-applied',
     async run({ signal }) {
       // return { status: 'pass' } or
       return {
         status: 'warn',
         attribution: 'user-fixable',
         detail: { variant: 'custom_without_url' },           // only declared variants compile
         actions: [{ kind: 'navigate', target: '/settings/general' }],
         evidence: [{ key: 'mode', value: 'custom', dataClass: 'public' }]
       }
     },
     fixes: {}                                                  // one handler per declared fix
   })
   ```
   `ctx.share(key, factory)` memoizes a probe for the current run, so checks in different layers (all the
   network checks, for instance) reuse one pass instead of probing again.
3. **Registry** — add the line in `registry.ts`. Until you do, the build fails.

Reference implementations: `checks/config.ts` (a check with a fix) and `checks/storage.ts` (a silent-fallback
detector). A check must be able to fail at runtime — anything preboot already guarantees is a dead check.

Then add i18n keys `settings.doctor.checks.<id>.title` and `.detail.<variant>` to `en-us.json` and run `pnpm i18n:sync`.

Rules the types enforce: a `fix` action can only name a fix the catalog declares; `detail.variant` must be declared;
`skip` and `error` are engine-only statuses; every declared fix needs a handler.

## Data classes

Every evidence item and basics field carries a `dataClass`. `projectDoctorReport(report, view)` builds the
`display` / `copy` / `export` / `upload` views; `consent_required` items only travel on explicit opt-in.
Paths and hostnames are `local_only`; raw error bodies are `consent_required`.

## Consuming from the renderer

```ts
const state = useSharedCacheValue('doctor.state')   // idle | running | completed | canceled
await ipcApi.request('diagnostics.doctor.run', { tier: 'quick' })      // then, on user click:
await ipcApi.request('diagnostics.doctor.run', { tier: 'live' })       // live = quick + live checks
await ipcApi.request('diagnostics.doctor.cancel', { runId })
await ipcApi.request('diagnostics.doctor.fix', { runId, checkId, fixId })
```

`run` returns `busy` with the in-flight `runId` while a run is active. `fix` is bound to the report's `runId`
and re-probes before executing; it answers `stale` when the run was superseded or the finding changed.
Reports carry `expiresAt`; after that the dialog should ask for a re-run before offering fixes.
