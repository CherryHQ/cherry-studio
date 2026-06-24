# Main Process Architecture (`src/main`)

This is the canonical reference for how `src/main/` is organized: what each top-level directory is for, the rules that keep them from sprawling, and how they depend on each other. It is the main-process peer of [Renderer Architecture](./renderer-architecture.md) and [Shared Layer Architecture](./shared-layer-architecture.md); the cross-process picture (process model, monorepo tree) lives in [Architecture Overview](./architecture-overview.md).

The top level is a **closed, locked set of principled categories**, not an open list of modules. Each top-level directory holds **one kind of thing** and earns its place for a distinct reason. **The set is locked** — a new capability is always routed into an existing category by its nature, never given a new top-level directory (§4).

## 1. The Closed Top-Level Set

Exactly these, each with a single charter:

| Dir | Category | Why it earns a top-level home |
|---|---|---|
| `core` | **App runtime** | Business-agnostic infrastructure concerned only with running the app. The test: lift `core/` onto a different Electron app, add other business code, and you have a different application. One kind of thing — the app substrate: lifecycle / DI container, path registry, logger, window manager, scheduler & jobs, preboot, diagnostics. |
| `ipc` | **Cross-process boundary** | Electron's defining inter-process mechanism — special and important enough to stand alone. Unified as **IpcApi** (schema + router + handler): the single typed boundary between main and renderer. |
| `data` | **Data layer** | The general business-data store — a first-class data layer, hence independent. Holds DbService / CacheService / PreferenceService / DataApiService / BootConfig, DB schemas, and the v1→v2 migrators (which by design read domain data — throwaway migration code). Detailed in [Data System Reference](./data/README.md). |
| `ai` | **Core domain** | Cherry Studio *is* an AI client, so AI earns its own top-level home: everything tied to the AI essence lives here (providers, middleware, MCP, agents, stream manager). Mirrors `@shared/ai`. |
| `features` | **Domain modules** | Business domains, one directory each. A complex domain bundles its own related services / utils / etc. under `features/<domain>/`. |
| `services` | **Business services** | Business feature services. A simple service is a single file; a larger one is organized into its own subdirectory. |
| `utils` | **Pure helpers** | Cross-domain pure functions with no single owner. |

Entry files: `index.ts` (process entry — runs preboot, then `application.bootstrap()`) and `ipc.ts` (legacy IPC registration, being retired into `ipc/`).

Naming follows [Naming Conventions §4.9](./naming-conventions.md): `core` / `data` / `ai` / `ipc` are singular namespaces; `features` / `services` / `utils` are plural buckets.

```text
src/main/
├── index.ts     # process entry: preboot → application.bootstrap()
├── ipc.ts       # legacy IPC registration (being retired into ipc/)
├── core/        # business-agnostic app runtime (lifecycle/DI, paths, logger, window, scheduler/job, preboot)
├── ipc/         # IpcApi — the typed main↔renderer boundary
├── data/        # the data layer (DB/Cache/Preference/DataApi/BootConfig, schemas, migration)
├── ai/          # the AI subsystem — the product's core domain
├── features/    # business domains, one dir each (each bundles its own services/utils)
├── services/    # business feature services (single file, or a subdirectory)
└── utils/       # cross-domain pure helpers
```

## 2. `features` vs `services` (Placement)

`services/` and `features/` are the same kind of thing — business logic — at two sizes. The split follows the cross-process rule in [Naming Conventions §4.10](./naming-conventions.md):

- **Promotion, not default — and in steps.** A small, self-contained service starts as a single file at the bucket root — `services/<Topic>Service.ts` (a stateful `Service`/`Manager` class is `PascalCase` matching its class name, [Naming §5.2](./naming-conventions.md); a pure helper is `utils/<topic>.ts`). When one file can no longer hold it, grow it **in place** into a `camelCase` topic subdirectory first — `services/<topic>/` holding `<Topic>Service.ts` plus its helpers — **not** straight into a feature. Mind the shape: the **directory is the topic name and carries no `Service` suffix** ([Naming §4.5](./naming-conventions.md)); only the class file keeps the suffix (e.g. `services/webSearch/WebSearchService.ts`). It earns a `features/<domain>/` home only once it grows into a **large, multi-file domain** bundling its own services, utils, and helpers (knowledge, apiGateway, fileProcessing). Do not pre-create a subdirectory or a feature for an anticipated module.
- **`ai/` is not an ordinary feature.** It is the product's core domain and has its own top-level home (§1); it is foundational, not one domain among many.
- **Route by shape** ([Naming Conventions §5.2](./naming-conventions.md)): a stateful class owning long-lived resources or persistent side effects → a lifecycle `Service` ([Lifecycle Reference](./lifecycle/README.md)); a stateless, independent service → `services/`; pure logic → `utils/`; a large domain → `features/<domain>/`.

### 2.1 Subdirectories and Barrels

A single `.ts` file is the default; promote a topic to a subdirectory only when it actually owns multiple files. Barrels then follow the same rule as [Shared Layer Architecture §3.1](./shared-layer-architecture.md), applied to both `services/` and `utils/`:

- **The bucket roots `services/` and `utils/` have no `index.ts`.** A bucket is a category, not a module — import the specific file or topic, never the whole bucket.
- **A `services/<topic>/` subdirectory has exactly one `index.ts`** as its public API (explicit named exports, no `export *`); its other files stay private behind it.
- **A complex `utils/<topic>/` subdirectory likewise has one `index.ts`.**
- **Why:** each topic is then imported through a single public entry — exactly like a one-file module — so its internal files stay private and consumers never deep-import. For `utils/`, where file and directory share the topic name, the specifier (`@main/utils/<topic>`) is even unchanged when a file grows into a folder.

(A `features/<domain>/` is the same single-entry idea one tier up: consumers import the domain through its one public entry, not its internal files.)

## 3. Dependency Direction

The charters imply a direction; dependencies flow toward the business-agnostic foundation:

- **Foundation** — `core/` and `utils/` carry no business knowledge; nothing business sits below them.
- **Data layer** — `data/` is the storage layer above the foundation.
- **Business** — `ai/`, `features/`, and `services/` are the business tier; they depend **down** on `data/`, `core/`, and `utils/`.
- **`ai/` is foundational within the business tier**: `features/` and `services/` may depend on it; it must not import a feature.
- **Feature domains are mutually isolated**: a `features/<domain>/` must not import a **sibling** feature — share through `services/`, `ai/`, `data/`, or `@shared`.
- **`ipc/` is the boundary adapter**: it resolves services through the DI container (`application.get`) rather than importing domain modules directly.
- **No renderer imports**: `src/main` and `src/preload` must not import renderer code. Cross-process types live in `@shared`, main-only types stay in `src/main` — see [Shared Layer Architecture](./shared-layer-architecture.md) for placement. Enforced by an ESLint `no-restricted-imports` rule banning `@types` / `@renderer` in `src/main` + `src/preload`; §7 tracks the one remaining exception.

Two dependencies cut across **every** directory and are **not** layering edges — they are ambient infrastructure access: `@logger` (logging) and `@application` (the DI container / service locator). A raw import scan shows almost everything "depending on `core`" only because of these two; the rules above concern direct module imports between domains.

There is no automated enforcement of the **internal** direction edges above yet (unlike the `import/no-restricted-paths` zones proposed for the renderer in [Renderer Architecture §5](./renderer-architecture.md)); direction is held by convention and review. The **external** main↔renderer boundary (no renderer imports) *is* enforced — see the rule above.

## 4. Closed Top-Level Governance

> **The seven top-level directories are the complete, locked set — treat adding a new one under `src/main/` as off the table.** This is [Naming Conventions §4.8](./naming-conventions.md) (top-level closed by default) at its strict end: §4.8 admits a new top-level directory only on proven *necessity* (no existing category can host the files) and *completeness*, and main's seven categories already span the space — so a new capability is routed into an existing category, never given its own directory. The [renderer (§6)](./renderer-architecture.md) and [`@shared` (§2)](./shared-layer-architecture.md) top levels are held to the same governance.

A new capability **never** earns a new top-level directory; route it by nature:

| The capability is… | Home |
|---|---|
| tied to the AI essence | `ai/` |
| business data / storage | `data/` |
| an IPC route | `ipc/` (IpcApi) |
| business-agnostic app-runtime infra | `core/` |
| a business service | `services/` — or `features/<domain>/` if it is a large, multi-file domain |
| pure, domain-agnostic logic | `utils/` |

## 5. Anti-Patterns

- Business code (anything specific to what Cherry Studio *does*) placed in `core/` — `core/` must stay app-runtime-only.
- A `features/<domain>/` importing a **sibling** feature (cross-domain coupling).
- `ai/` importing `features/` (the core domain depending up on a feature).
- Opening a new top-level directory for a single capability (§4).
- Scattering business data through ad-hoc storage instead of the `data/` subsystems, or imperative commands through ad-hoc channels instead of `ipc/` (IpcApi).

## 6. Subsystem References

Per-subsystem depth lives in dedicated docs; this page owns only the directory layout. Do not duplicate subsystem detail here.

| Subsystem | Location | Reference |
|---|---|---|
| Service lifecycle (IoC, phased bootstrap) | `core/lifecycle/`, `core/application/` | [Lifecycle Reference](./lifecycle/README.md) |
| Startup phases (preboot / bootstrap / running) | `core/preboot/`, `core/application/` | [core/README](../../src/main/core/README.md) |
| Window manager | `core/window/` | [Window Manager Reference](./window-manager/README.md) |
| Scheduler & jobs | `core/scheduler/`, `core/job/` | [Job & Scheduler Reference](./job-and-scheduler/README.md) |
| Path registry | `core/paths/` | [paths/README](../../src/main/core/paths/README.md) |
| Data systems (DB/Cache/Preference/DataApi/BootConfig) | `data/` | [Data System Reference](./data/README.md) |
| IPC (IpcApi) | `ipc/` | [IPC Reference](./ipc/README.md) |
| AI subsystem | `ai/` | [AI Reference](./ai/README.md) |

## 7. Current Deviations (target vs current)

This page describes the **target**. Where current code does not yet match it, the gap is tracked below — **this pass changes no code**. Only structural deviations are listed (the closed top-level set §4, bucket barrels §2.1, placement §2); a per-file naming-suffix audit (§5.2) is out of scope here.

| Area | Current | Target |
|---|---|---|
| `utils/index.ts` | a bucket-root `index.ts` holds loose helpers (`debounce`, `makeSureDirExists`, `toAsarUnpackedPath`, …) — the junk-drawer root barrel §2.1 forbids | split into named topic files (`utils/<topic>.ts`); `@shared` has already done exactly this — see [Shared Layer Architecture §6](./shared-layer-architecture.md) |
| legacy `ipc.ts` | v1 IPC registration at the process root, coexisting with IpcApi | domains migrate into `ipc/` (IpcApi) incrementally until `ipc.ts` is retired (§1) |
| `utils/language.ts` i18n | imports renderer i18n JSON via relative path (`../../renderer/i18n/locales/*`, `translate/*`) to build the main-process `t()` table — a main→renderer edge (§3 No-renderer-imports) the ESLint rule does not yet catch (relative `**/renderer/**` is intentionally left unbanned so this still compiles) | relocate the locale JSON to a process-neutral on-disk resource loaded per-process via `i18next-fs-backend`, so main reads its own slice. Marked `TODO(i18n-migration)` in the file; once done, tighten the ESLint group to also ban relative `**/renderer/**` |

By-design edges are **not** deviations and are deliberately omitted: the `data/migration/v2/` migrators reading domain data (§1) and `@logger` / `@application` ambient access from any tier (§3).

## 8. Related

- [Architecture Overview](./architecture-overview.md) — process model, data flow, monorepo tree (the cross-process parent of this doc).
- [Renderer Architecture](./renderer-architecture.md) / [Shared Layer Architecture](./shared-layer-architecture.md) — the peer per-process directory references.
- [Naming Conventions](./naming-conventions.md) — §4.8 closed top-level, §4.9 singular/plural, §4.10 feature vs type-bucket, §5.2 route-by-shape.
