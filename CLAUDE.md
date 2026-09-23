## Guiding Principles (MUST FOLLOW)

### Mindset

How to approach any coding task in this repo.

#### Think Before Coding

- State assumptions explicitly. If uncertain, ask before implementing.
- When multiple interpretations exist, surface them — do not pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what is confusing. Ask.

#### Simplicity First

- Write the minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that was not requested.
- No error handling for impossible scenarios.
- If you wrote 200 lines and it could be 50, rewrite it.
- Inline comments cap at 2 lines. Needing more means the code is a patch — fix the implementation instead of narrating it. Say *why*, never restate *what*; no changelogs, no rationale essays, no pasted chat/review replies. (Doc comments on an exported API — TSDoc `@param`/`@returns`/`@deprecated` — are documentation, not narration, and are exempt.)

#### Surgical Changes

- Touch only what the task requires. Do not "improve" adjacent code, comments, or formatting.
- Do not refactor things that are not broken.
- Match existing style even if you would do it differently.
- If you notice unrelated dead code, mention it — do not delete it.
- Remove imports / variables / functions that **your** changes orphaned. Leave pre-existing dead code alone unless asked.
- Every changed line must trace directly to the user's request.

#### Goal-Driven Execution

- Convert tasks into verifiable goals before coding:
  - "Add validation" → "Complete the production validation path, then exercise it through the real boundary."
  - "Fix the bug" → "Reproduce it through a production entry point, fix it, then rerun that integration flow."
  - "Refactor X" → "Complete the coherent refactor, then exercise the affected integration flow."
- For multi-step tasks, state a brief plan and the integration boundary that will verify the completed set:

```
1. [Implementation set]
2. [Completed boundary] → verify: [integration flow]
```

### Operational Rules

Project-specific tools, paths, and conventions.

- **Keep it clear**: Write code that is easy to read, maintain, and explain.
- **Read local READMEs first**: Before editing code in a directory, check for a `README.md` in that directory (and its parents) and read it — these files capture local conventions, invariants, and entry points that aren't obvious from the code alone.
- **Fix upstream, don't hack downstream**: When a new feature hits an existing module's limitation, flag the upstream improvement for the user's decision before proposing a downstream workaround.
- **Library-first, custom-last**: Before writing custom code, check library/framework docs for built-in options or existing solutions. Write custom code only when no adequate alternative exists.
- **Build with Tailwind CSS & Shadcn UI**: Use components from `@cherrystudio/ui` (located in `packages/ui`, Shadcn UI + Tailwind CSS) for every new UI component.
- **Log centrally**: Route all logging through `loggerService` with the right context—no `console.log`.
- **Access paths centrally**: Use `application.getPath('namespace.key', filename?)` for all main-process filesystem paths—never call `app.getPath()`, `os.homedir()`, or construct paths ad-hoc. Import the singleton via `import { application } from '@application'`.
- **Verify completed behavior at its real boundary**: finish the coherent production change first, then run the smallest integration flow that enters through the actual UI, IPC, process, filesystem, database, or protocol boundary. Unit, component-only, snapshot, filtered-function, and mock-only tests are not completion evidence. Run `pnpm lint` once at the completed change boundary when TypeScript changed. Reserve `pnpm build:check` and broad integration suites for the final applicable phase. Docs-only changes use `pnpm docs:check`.
- **Write conventional commits**: Commit small, focused changes using Conventional Commit messages (e.g., `feat(data-api):`, `fix(lifecycle):`, `refactor(quick-assistant):`, `docs(testing):`, `chore(deps):`, `test(window-manager):`). Scope must be a specific kebab-case module, never generic like `main` — when `git log` conflicts with this rule, this rule wins.
- **Sign commits and sign off**: Every commit must be both cryptographically signed and DCO-signed off. Use `git commit -S --signoff` (not `--signoff` alone), verify the commit object contains a `gpgsig` header with `git cat-file commit HEAD`, and verify the pushed PR commits show `Verified` on GitHub.
- **Target the right branch**: `main` is the default branch for all active development — submit features, refactors, optimizations, and fixes here.

## Development

### Commands

Run `pnpm install` first (Node and pnpm versions are pinned in `package.json` — let it enforce them). For every other script, read `package.json` — the ones you must know:

- `pnpm lint` — oxlint + eslint fix + typecheck + i18n check + format (writes files)
- `pnpm test` — legacy broad Vitest suite; final-boundary use only and not completion evidence when it includes unit tests
- `pnpm format` — Oxfmt format (write mode)
- `pnpm docs:check` — the docs gate (`check-links` + structure closed-set + frontmatter/`sources` existence + generated-index freshness); the only thing `build:check` adds over `lint` + `test`. Run it for docs/markdown edits instead of the full gate. Docs under `docs/references/**` and `docs/contrib/**` carry `description`/`sources` frontmatter; `docs/README.md` is generated — edit frontmatter and run `pnpm docs:index`, never the index by hand.
- `pnpm build:check` — `lint` + `docs:check` + the broad legacy suite; run once at the final applicable phase or release boundary. If it fails on i18n sort, run `pnpm i18n:sync` first; on formatting, run `pnpm format` first; on broken doc links, fix the link.
- `pnpm test:lint` — the CI-equivalent lint gate: Oxlint errors and warnings block CI (`--deny-warnings`); ESLint errors block CI while its warnings remain non-blocking.

### Testing

- Integration scenarios use Vitest 3 where the real application boundary can be driven through its project configuration.
- **No unit-test delivery loops**: do not add or run unit, component-only, snapshot, filtered-function, or mock-only tests as delivery evidence. Existing legacy tests may remain, but their results do not prove a feature complete.
- **No behavior-pinning tests**: a scenario whose assertion merely records current output, mock calls, or an expected value re-derived from the implementation has zero value. Exercise real input through the production boundary and assert the promised outcome. Before adding an integration scenario, state the production defect it would catch; if none, do not add it.
- **Frontend integration**: use the relevant production-flow guidance from [Frontend Testing Guidelines](docs/references/testing/frontend-testing.md); component-only guidance is not a completion gate.
- **Mocks**: mock-only scenarios are not evidence. If maintaining a legacy test that requires a mock, use the unified system in [tests/__mocks__/README.md](tests/__mocks__/README.md) and do not cite the result as completion proof.
- **Database Tests**: For any service/handler/seeder that reads or writes SQLite, use `setupTestDatabase()` from `@test-helpers/db` — it provides a real file-backed DB with production migrations. Do NOT hand-write `CREATE TABLE` SQL, override `@application`, or stub Drizzle chains. See [docs/references/testing/database-testing.md](docs/references/testing/database-testing.md).

### Patched Dependencies

Before upgrading any dependency, check `patches/` for custom patches.

## GitHub

### Pull Requests

Use the `gh-create-pr` skill. Fallback: read `.agents/skills/gh-create-pr/SKILL.md` directly.

### Code Review

When reviewing a GitHub PR, do NOT run `pnpm lint` / `pnpm test` / `pnpm format` locally — its CI already ran them; inspect via `gh` instead.

### Issues

Use the `gh-create-issue` skill. Fallback: read `.agents/skills/gh-create-issue/SKILL.md` directly.

## Conventions

### TypeScript

- Cross-process types belong in `src/shared/`; renderer-only shared types in `src/renderer/types/` (see [Shared Layer Architecture](docs/references/architecture/shared-layer.md)).

### Naming Conventions

**MUST READ**: [docs/references/architecture/naming-conventions.md](docs/references/architecture/naming-conventions.md) — files, directories, identifiers, and singular/plural rules.

### Logging

```typescript
import { loggerService } from "@logger";
const logger = loggerService.withContext("moduleName");
// Renderer only: loggerService.initWindowSource('windowName') first
logger.info("message", CONTEXT);
logger.warn("message");
logger.error("message", error);
```

### Paths

**MUST READ**: [src/main/core/paths/README.md](src/main/core/paths/README.md) — namespaces, naming, adding new keys, testing patterns. (Rule stated in Guiding Principle "Access paths centrally".)

### i18n

- All user-visible strings must use `i18next` — never hardcode UI strings
- Locale catalogs live in `src/renderer/i18n/locales/` and `src/main/i18n/locales/`; both use `en-us.json` as the source of truth
- Only when you add or change a key: edit `en-us.json`, run `pnpm i18n:sync` (fills the other locales with `[to be translated]:` placeholders), then translate every one. No separate `pnpm i18n:check` run needed — `pnpm lint` includes it, and it rejects leftover placeholders as well as empty values, interpolation/tag mismatches, and unsorted keys.

### UI Design

For any UI component or page style work, read [DESIGN.md](./DESIGN.md) first and follow its colors, fonts, spacing, and component specs strictly.

## Architecture

### Code Organization

Where each file and directory belongs — read the doc for the process you're touching before adding code or opening a directory. Each process root's top level is a **closed set**: route new code into an existing category, never a new top-level directory ([Naming Conventions §4.8](docs/references/architecture/naming-conventions.md)).

A directory's `index.ts` is a **barrel** — an enforced encapsulation boundary re-exporting one cohesive public API (internals private, outsiders import through it): re-export only (no logic / `export *`), no nesting, and it exists only if lint can seal off deep imports — else no barrel. `index.tsx` is always banned ([Naming Conventions §6.4](docs/references/architecture/naming-conventions.md)).

- [Main Process Architecture](docs/references/architecture/main-process.md) — `src/main/` directories (`core`/`ipc`/`data`/`ai`/`features`/`services`/`utils`/`i18n`) and dependency direction.
- [Renderer Architecture](docs/references/architecture/renderer.md) — `src/renderer/` two-axis (type × domain) layout and downward-only layering.
- [Shared Layer Architecture](docs/references/architecture/shared-layer.md) — what belongs in `@shared` (cross-process + no mutable runtime state) and its closed top-level set.

### Data

**MUST READ**: [docs/references/data/README.md](docs/references/data/README.md) for system selection, architecture, and patterns.

| System                                                     | Use Case                            | APIs                                                       |
| ---------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| [BootConfig](docs/references/data/boot-config-overview.md) | Early boot settings (pre-lifecycle) | `bootConfigService.get()`, `usePreference('BootConfig.*')` |
| [Cache](docs/references/data/cache-overview.md)            | Temp data (can lose)                | `useCache`, `useSharedCache`, `useSharedCacheValue`, `usePersistCache` |
| [Preference](docs/references/data/preference-overview.md)  | User settings                       | `usePreference`                                            |
| [DataApi](docs/references/data/data-api-overview.md)       | Business data (**critical**)        | `useQuery`, `useMutation`                                  |

Scope:

- **BootConfig**: sync file-based; direct in main (pre-lifecycle), via `usePreference('BootConfig.*')` otherwise
- **Cache**: memory / shared (cross-window) / persist tiers; memory + shared on both main and renderer; persist on both too but as **independent** stores (renderer = localStorage, main = JSON file at `{userData}/cache.json`), never shared — main additionally relays renderer persist sync between windows
- **Preference**: cross-process (main + renderer); auto-syncs across windows
- **DataApi**: SQLite-backed; no auto-sync, fetch on demand from renderer

Database: SQLite via **better-sqlite3** + Drizzle ORM — the driver is **synchronous** (queries and transactions run inline with no `await`, unlike the app's otherwise-async data layers), so `getDb()` queries and `withWriteTx(fn)` callbacks must be written synchronously. Schemas in `src/main/data/db/schemas/`, migrations via `pnpm db:migrations:generate`

**Write atomicity**: use `application.get('DbService').withWriteTx(fn)` to commit multiple writes (or a read-then-write) all-or-nothing in one synchronous `BEGIN IMMEDIATE` transaction; `fn` must be synchronous. A single write doesn't need it — better-sqlite3 runs each statement atomically on its one connection. See [Database Patterns — Write Serialization](docs/references/data/database-patterns.md#write-serialization-dbservicewritewritetx).

**DataApi boundary rule**: DataApi is for SQLite-backed business data only. No database table → no DataApi endpoint; use IPC instead. See [Scope & Boundaries](docs/references/data/api-design-guidelines.md#dataapi-scope--boundaries).

### IPC (IpcApi)

**MUST READ**: [docs/references/ipc/README.md](docs/references/ipc/README.md) — paradigm boundary (RPC vs REST), schema/router/preload/facade layering, `IpcContext`, error model, security.

Non-data command IPC (window/system/shell/notification/external/file) goes through **IpcApi** — the fifth subsystem alongside BootConfig/Cache/Preference/DataApi, RPC-over-IPC with single-point schemas (`schema + handler` to add a route; `ipcApi.request('namespace.action', input)` to call; `IpcApiService.broadcast`/`send` + `useIpcOn` for events). Legacy command IPC still coexists, so you'll encounter both. Decision: SQLite data → DataApi; user setting → Preference; losable/shared → Cache; everything else imperative → IpcApi.

### Window Manager

**MUST READ**: [docs/references/window-manager/README.md](docs/references/window-manager/README.md) — lifecycle modes, pool mechanics, API reference.

All `BrowserWindow` goes through `WindowManager` with one of three modes (`default` / `singleton` / `pooled`), declared per type in `src/main/core/window/windowRegistry.ts`.

- **Consumer API**: use only `open()` / `close()` — never `create()` / `destroy()` in business code.
- **Attach listeners in `onWindowCreated`**, not after `open()` — reused windows skip the latter.
- **Renderer reads init data via `useWindowInitData`**.

### Main Process Services (Lifecycle)

**MUST READ**: [docs/references/lifecycle/README.md](docs/references/lifecycle/README.md) — architecture, decision guides, usage patterns, and migration steps.

All main-process services that own long-lived resources or register persistent side effects **must** use the lifecycle system:

- **Extend `BaseService`**, apply `@Injectable`, `@ServicePhase`, `@DependsOn` decorators
- **Register in `serviceRegistry.ts`** (`src/main/core/application/serviceRegistry.ts`) — one line per service
- **Use `@DependsOn` for same-phase dependencies only** — do NOT declare dependencies on BeforeReady services (`PreferenceService`, `DbService`, `CacheService`, `DataApiService`) from WhenReady services; phase ordering is auto-enforced by the container
- **Access via `application.get('Name')`** (or `getOptional()` for `@Conditional` services)
- **Use `this.ipcHandle()` / `this.ipcOn()`** for IPC — auto-cleaned on stop/destroy, returns `Disposable`
- **Use `this.registerInterval()`** for recurring timers — auto-unref'd, exception-isolated, auto-cleaned on stop/destroy, returns `Disposable`
- **Use `this.registerDisposable()`** for cleanup tracking — accepts `Disposable` objects or `() => void` cleanup functions
- **Use `Emitter<T>` / `Event<T>`** for inter-service events, **`Signal<T>`** for one-shot completion
- **Implement `Activatable`** for services with heavy on-demand resources (IPC stays registered, resources load/release via `onActivate()`/`onDeactivate()`)
- **Do NOT** use `new` or manual singleton patterns — the container manages instantiation, ordering, and shutdown

For detailed code examples, see [Usage Guide](docs/references/lifecycle/lifecycle-usage.md). For migrating legacy services, see [Migration Guide](docs/references/lifecycle/lifecycle-migration-guide.md).

### Non-Lifecycle Services (Direct-Import Singleton)

Services without long-lived resources or persistent side effects: use **named export singleton** (`export const x = new X()`). No `getInstance()` patterns. See [Decision Guide](docs/references/lifecycle/lifecycle-decision-guide.md) for criteria.

## Schema & Migration Rules

The v2 refactor has landed. v1 data reaches v2 only through the migrators in `src/main/data/migration/v2/` — never add fallbacks, dual-writes, or guards for v1 save / read / loss.

**The migration chain is no longer throwaway.** It was consolidated into a single clean initial migration and shipped with `v2.0.0-rc.1`, so `migrations/sqlite-drizzle/` now runs against databases holding real user rows. Never wipe or rewrite an already-shipped migration, and never tell a user to delete their database: schema changes go in as new appended migrations generated by `pnpm db:migrations:generate`. `src/main/data/db/schemas/` still changes freely — but every change must survive a migrate-forward on a populated database.

**Resolving migration merge conflicts: regenerate, never rename.** When an upstream migration conflicts with your local one, delete your local `.sql` + its `meta/*_snapshot.json` and re-run `pnpm db:migrations:generate`. Renaming/renumbering instead silently reuses the snapshot's random `id`, forking the chain for everyone — and `drizzle-kit generate` still exits `0`; only `pnpm db:migrations:check` catches it. CI enforces both the chain check and a schema↔migration generate-and-diff step.

### Data Classification Toolchain

`scripts/data-classify/` is the code generation pipeline for the v2 data layer; `classification.json` is the single source of truth (see its README). Four files are **auto-generated — NEVER edit them by hand**: `src/shared/data/preference/preferenceSchemas.ts`, `src/shared/data/bootConfig/bootConfigSchemas.ts`, and `PreferencesMappings.ts` + `BootConfigMappings.ts` in `src/main/data/migration/v2/migrators/mappings/`. To change them, edit `classification.json` or `target-key-definitions.json` (both in `data/`), then run `cd scripts/data-classify && npm run generate`.

## Local Instructions

If `CLAUDE.local.md` exists in the repository root (gitignored, may be absent), read it in full before acting on anything in this file — it holds the developer's private instructions and **OVERRIDES this file wherever they conflict**. Tools that auto-load it (e.g. Claude Code) need not re-read it.

<!-- prometheus-mini-context:start v1 -->
## Prometheus development context

- The testing policy in this managed block takes precedence over conflicting
  per-edit, unit-first, mock-first, or test-first instructions elsewhere. Report
  the stale prose for manual cleanup; do not follow both policies.
- Restore KBD position and read `versions.toml`, `.prometheus/decisions.md`, and
  relevant `.prometheus/gotchas.md` before dependency or architecture changes.
- Finish a coherent set of production functionality before testing. During
  implementation, use static inspection and reasoning; use a narrow compiler or
  type check only when it is required to unblock progress.
- At a completed change or phase boundary, run the smallest integration flow that
  exercises the real production entry point and collaborators. Unit, mock-only,
  filtered-function, snapshot, and per-edit tests are not completion evidence.
- Run broad integration, cross-platform, and release gates once at the final
  applicable boundary. Report only commands and results actually observed.
- For Rust work, load `prometheus-rust-workspace`. It routes
  `rust-best-practices`, `rust-async-patterns`, and
  `rust-mcp-server-generator` when relevant. Project pins and protocols win.
- Stack details live under `.claude/rules/`; load only the rule matching the files
  being changed. Preserve operator prose outside this managed region.
<!-- prometheus-mini-context:end -->
