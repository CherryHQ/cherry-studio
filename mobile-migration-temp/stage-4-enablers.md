# Stage 4 — Structural Enablers (Prerequisites for Stage 5)

## Objective

Extract the two pieces of infrastructure that Stage 5 tracks depend on: a shared service-lifecycle
kernel (4a → required by Track A Wave 2 and Track C) and shared database table definitions
(4b → required by Track C). Neither directly removes business-logic duplication; both unblock the
tracks that do.

## Preconditions

Stage 1. 4a and 4b are mutually independent. Before 4b, both applications must converge on one
resolved `drizzle-orm` version (see 4b); this is a hard dependency, not an optional cleanup.

---

## 4a. `lifecycle-kernel` extraction

### Background (measured)

The mobile codebase is a **port of the desktop lifecycle framework** (mobile's own README:
"Mobile now runs Desktop's lifecycle framework — container, dependency graph, and phases"). The two
copies are ~90% API-congruent but textually rewritten almost in full, and — critically —
`src/main/core` is **not covered by any `desktop-sync-manifest.json` domain**: this fork drifts
untracked.

| Aspect | Desktop `src/main/core/lifecycle/` | Mobile `apps/mobile/src/backend/core/lifecycle/` |
|---|---|---|
| Congruent modules | `ServiceContainer`, `DependencyResolver`, `LifecycleManager`, `BaseService`, `decorators`, `event`, `signal`, `types` | Same module set, same names |
| Decorator deltas | `@Conditional` (desktop-only) | `@AppStatePolicy` (mobile-only; foreground/background policy metadata) |
| BaseService deltas | `ipcHandle`/`ipcOn` (Electron IPC binding) | IPC hooks removed (documented in-source: "There is no ipcMain here") |
| Phase topology | `BeforeReady` / `WhenReady`, anchored to Electron `app` events | `Gate` / `PostReady`, anchored to React mount + startup cover |
| Host model | `Application` process-lifetime singleton | `ApplicationHost`, replaceable in place (Fast Refresh, per-test generations) |

**Consequent design:** unify the kernel; keep the anchors per-application. The platform-bound
surface is exactly four things — phase topology, host model, platform hook mixins, and shutdown
guarantees — none of which live in the container/resolver/scheduler core.

### Procedure

1. **API-level design review (standalone deliverable, one-page decision record committed to this
   directory).** Compare both implementations module-by-module and fix the convergence direction.
   Working hypothesis: desktop migrates onto the mobile variant (replaceable host + generation
   support is a strict superset), but this is to be confirmed by review, not assumed.
2. Create `packages/lifecycle-kernel/src/` containing the platform-independent core:
   - `ServiceContainer.ts`, `DependencyResolver.ts`, `event.ts`, `signal.ts`, `types.ts`
   - `decorators.ts` — `@Injectable`, `@DependsOn`, `@ServicePhase`, `@Priority`,
     `@ErrorHandling` (excluding `@Conditional` and `@AppStatePolicy`)
   - `BaseService.ts` — `registerDisposable`, `registerInterval`, `onActivate`/`onDeactivate`,
     `onStop` only
   - `LifecycleManager.ts` — **phase list parameterized** (generic/constructor argument; no
     hard-coded phase enum)
3. Desktop side thins out (`src/main/core/lifecycle/` becomes shims + extensions):
   - Retained: `constants.ts` (phase enum), `conditions.ts` (`@Conditional`)
   - New `DesktopBaseService.ts` extends the kernel BaseService with `ipcHandle`/`ipcOn`
   - Original module paths re-export kernel + extensions — **all 55 registered services and
     `serviceRegistry.ts` compile unchanged** (strangler shims; Invariant I2)
4. Mobile side symmetrically: retains `Gate`/`PostReady`, `@AppStatePolicy`, `ApplicationHost`;
   original paths shim the kernel.
5. The shared-service contract (Stage 0e §3–4) becomes operative: four behavioral rules + phase
   assignment at registration site.

### Verification

Desktop: `pnpm test:main` (lifecycle has its own `__tests__`) + full `pnpm test` + `pnpm dev`
boot smoke. Mobile: `pnpm --filter cherry-studio-app test` (bootstrap/composition suites cover
host replacement) + dev-client boot smoke.

---

## 4b. `db-schema`: shared table definitions, per-application migration chains

### Principle

Drizzle table definitions are pure declarations (zero platform dependencies) and can be shared;
`drizzle-kit generate` derives each application's incremental migrations by diffing the shared
definitions against that application's own migration snapshot. **Sharing schema definitions and
keeping migration chains separate are compatible.** The chains are permanently disjoint (measured:
desktop `0000_orange_jasper_sitwell…` ×9 vs mobile `0000_release_baseline…` ×8, zero shared
filenames, generated under different `drizzle-orm` versions) and are never merged.

### Procedure

1. **Dependency convergence (hard prerequisite):** desktop currently declares `drizzle-orm`
   `^0.44.5` while mobile declares `^0.45.2`. A shared schema package cannot expose one set of
   Drizzle table/query types to consumers resolved against incompatible copies. Align both apps and
   `packages/db-schema` on one tested version before moving a schema; verify both migration
   toolchains and populated-database migrate-forward gates after the upgrade.
2. **Convergence survey:**
   `diff -rq src/main/data/db/schemas/ apps/mobile/src/backend/data/db/schemas/` — classify every
   table as shape-identical / shape-divergent / single-sided. (The sync-manifest `schema` domain is
   currently `unbaselined`; this survey is its baseline.)
3. **Shape convergence:** for divergent tables, each application appends its own forward migration
   to reach the agreed shape. Repository law applies unchanged on both sides: shipped migrations
   are never rewritten; conflicts are resolved by regenerate-never-rename.
4. Create `packages/db-schema/src/`; `git mv` the converged table definitions in. Repoint both
   drizzle configs — desktop `migrations/sqlite-drizzle.config.ts`, mobile
   `apps/mobile/drizzle.config.ts` — at the package path. Original schema directories keep shims.
5. Single-sided tables (desktop v1-migration auxiliaries, mobile-only tables) remain in per-app
   supplementary schema files; each drizzle config lists package + supplement as multiple schema
   paths.
6. CI: both applications' migration checks gate the package — desktop `db:migrations:check`,
   mobile `db:generate` idempotence (no pending diff). A table-definition change therefore fails
   CI unless both chains have been regenerated.

### Verification

Both sides: migrate-forward against a populated database copy (already mandated desktop policy);
`pnpm db:migrations:check`; mobile `db:generate` produces an empty diff.
