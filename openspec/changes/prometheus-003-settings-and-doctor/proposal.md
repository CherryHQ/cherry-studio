## Why

The Prometheus skill system needs a place in Settings where an operator can see its health, run
its doctor, repair what is repairable, and control the push of skills into the OS-level skill
directories that other CLI tools read.

Three quarters of the machinery exists. The Doctor subsystem already runs checks and publishes
partial results as they arrive — `DoctorService.ts:298-301` republishes through an `execute()`
callback onto a shared cache key, and the renderer subscribes with `useSharedCacheValue`
(`useCache.ts:397-403`), so progress never travels over IPC. Repair is already modelled
(`checks/config.ts:22-35`: `actions: [{ kind: 'fix', fixId }]` plus a `fixes` handler). The
settings chrome exists (`SettingsPrimitives.tsx`, `@cherrystudio/ui`).

What is missing: a check source that runs the mini's doctor, a settings section, and the
home-directory push — which does not exist in any form today; skill discovery here is import-only.

## What Changes

- **A Prometheus check source.** The mini's `DoctorCheckRegistry` cannot be extended from outside:
  `DoctorCheckId` is a closed union (`src/shared/types/doctor.ts:80,113`) and `DomainOfId` enforces
  domain == id prefix at compile time. So main spawns `node scripts/doctor.mjs` from the app-data
  copy and maps its JSON lines onto check results. The mapping is already specified on the mini
  side in `lib/doctor/contract.md`, including `refused` → `{ status: 'failed', message }`, for
  which this host has no native equivalent.
- **One-click repair** for the single check that offers one (`mini-skill-copies` → `copy-skills`),
  routed back to `node scripts/doctor.mjs --fix copy-skills`.
- **An every-startup push** of the skills into `<home>/.agents/skills/<name>` and
  `<home>/.claude/skills/<name>` — copies, never symlinks — as a lifecycle service chained after
  `reconcileSkills()`, never from `main.ts`, with a non-modal notice while it runs. **On a machine
  where the full Prometheus pack is installed the push is skipped entirely** and a persistent
  notice says why; the two must never shadow each other's skills. This is distinct from the
  on-demand repair above: different trigger, different feedback, unattended.
- **A `/settings/prometheus` section** showing health, services, and push state, registered in the
  three places a section requires: the route file, `settingsMenu.ts`, and a `*.search.ts` leaf.
- **Preferences** added to `scripts/data-classify/data/classification.json` and regenerated —
  never by hand-editing the generated `preferenceSchemas.ts`. The `preference` table is key/value
  JSON, so **no migration is needed**.
- **Every string** through i18n in all 13 locales; `i18n:check` fails CI on a missing *or extra*
  key.

## Impact

- Affected: a new main-process lifecycle service (BaseService, `@Injectable`, registered in
  `serviceRegistry.ts`, reached via `application.get(...)`), a doctor check source, a settings
  page and its three registrations, `classification.json`, 13 locale files.
- All paths via `application.getPath('namespace.key')`; all logging via
  `loggerService.withContext(...)`.
- Security (A-3): the push writes under the user's home directory — a real trust boundary. It
  delegates to the mini's `copy-skills`, which already refuses path escapes, never deletes, and
  refuses outright beside a full pack. The UI SHALL NOT offer a path around those refusals.

## Non-goals

- Reimplementing the copy. The mini owns it and it is mutation-tested there.
- A second progress mechanism. The shared-cache pattern is the one the Doctor already uses.
- Docker lifecycle — `prometheus-004`.
