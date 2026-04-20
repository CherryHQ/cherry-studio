## Guiding Principles (MUST FOLLOW)

- **Keep it clear**: Write code that is easy to read, maintain, and explain.
- **Start simple**: Begin with the simplest design — no extra abstraction layers, wrapper classes, or separate services unless explicitly requested. Prefer flat, minimal designs.
- **Fix upstream, don't hack downstream**: When a new feature hits an existing module's limitation, flag the upstream improvement for the user's decision before proposing a downstream workaround.
- **Read local READMEs first**: Before editing code in a directory, check for a `README.md` in that directory (and its parents) and read it — these files capture local conventions, invariants, and entry points that aren't obvious from the code alone.
- **Library-first, custom-last**: Before writing custom code, check library/framework docs for built-in options or existing solutions. Write custom code only when no adequate alternative exists.
- **Match the house style**: Reuse existing patterns, naming, and conventions.
- **Research via subagent**: Lean on `subagent` for external docs, APIs, news, and references.
- **Build with Tailwind CSS & Shadcn UI**: Use components from `@cherrystudio/ui` (located in `packages/ui`, Shadcn UI + Tailwind CSS) for every new UI component; never add `antd`, `HeroUI`, or `styled-components`.
- **Log centrally**: Route all logging through `loggerService` with the right context—no `console.log`.
- **Access paths centrally**: Use `application.getPath('namespace.key', filename?)` for all main-process filesystem paths—never call `app.getPath()`, `os.homedir()`, or construct paths ad-hoc. Import the singleton via `import { application } from '@application'`.
- **Lint, test, and format before completion**: Coding tasks are only complete after running `pnpm lint`, `pnpm test`, and `pnpm format` successfully.
- **Write conventional commits**: Commit small, focused changes using Conventional Commit messages (e.g., `feat(data-api):`, `fix(lifecycle):`, `refactor(quick-assistant):`, `docs(testing):`, `chore(deps):`, `test(window-manager):`). Scope must be a specific kebab-case module, never generic like `main` — when `git log` conflicts with this rule, this rule wins.
- **Sign commits**: Use `git commit --signoff` as required by contributor guidelines.

## Development

### Commands

Run `pnpm install` first (requires Node ≥22, pnpm 10.27.0). For every other script, read `package.json` — the ones you must know:

- `pnpm lint` — oxlint + eslint fix + typecheck + i18n check + format check
- `pnpm test` — run all Vitest tests
- `pnpm format` — Biome format + lint (write mode)
- `pnpm build:check` — **REQUIRED before commits** (`pnpm lint && pnpm test`). If it fails on i18n sort, run `pnpm i18n:sync` first; on formatting, run `pnpm format` first.

### Testing

- Tests run with Vitest 3 (see `vitest.config.*` for project setup).
- **Features without tests are not considered complete**
- **Test Mocking**: Use the unified mock system — do NOT create ad-hoc mocks for `application`, services, or data layers. See [tests/__mocks__/README.md](tests/__mocks__/README.md) for available mocks, usage patterns, and best practices.
- **Database Tests**: For any service/handler/seeder that reads or writes SQLite, use `setupTestDatabase()` from `@test-helpers/db` — it provides a real file-backed DB with production migrations. Do NOT hand-write `CREATE TABLE` SQL, override `@application`, or stub Drizzle chains. See [docs/references/testing/database-testing.md](docs/references/testing/database-testing.md).

### Patched Dependencies

Before upgrading any dependency, check `patches/` for custom patches.

## GitHub

### Pull Requests

When creating a Pull Request, you MUST use the `gh-create-pr` skill.
If the skill is unavailable, directly read `.agents/skills/gh-create-pr/SKILL.md` and follow it manually.

### Code Review

When reviewing a Pull Request, do NOT run `pnpm lint`, `pnpm test`, or `pnpm format` locally.
Instead, check CI status directly using GitHub CLI:

- **Check CI status**: `gh pr checks <PR_NUMBER>` - View all CI check results for the PR
- **Check PR details**: `gh pr view <PR_NUMBER>` - View PR status, reviews, and merge readiness
- **View failed logs**: `gh run view <RUN_ID> --log-failed` - Inspect logs for failed CI runs

Only investigate CI failures by reading the logs, not by re-running checks locally.

### Issues

When creating an Issue, you MUST use the `gh-create-issue` skill.
If the skill is unavailable, directly read `.agents/skills/gh-create-issue/SKILL.md` and follow it manually.

## Conventions

### TypeScript

- Place shared type definitions in `src/renderer/src/types/` or `packages/shared/`.

### File Naming

- React components: `PascalCase.tsx`
- Services, hooks, utilities: `camelCase.ts`
- Test files: `*.test.ts` or `*.spec.ts` alongside source or in `__tests__/` subdirectory

### Logging

```typescript
import { loggerService } from "@logger";
const logger = loggerService.withContext("moduleName");
// Renderer only: loggerService.initWindowSource('windowName') first
logger.info("message", CONTEXT);
logger.warn("message");
logger.error("message", error);
```

- Never use `console.log` — always use `loggerService`

### Paths

**MUST READ**: [src/main/core/paths/README.md](src/main/core/paths/README.md) — namespaces, naming, adding new keys, testing patterns. (Rule stated in Guiding Principle "Access paths centrally".)

### i18n

- All user-visible strings must use `i18next` — never hardcode UI strings
- Run `pnpm i18n:check` to validate; `pnpm i18n:sync` to add missing keys
- Locale files in `src/renderer/src/i18n/`

### UI Design

For any UI component or page style work, read [DESIGN.md](./DESIGN.md) first and follow its colors, fonts, spacing, and component specs strictly.

## Architecture

### Data

**MUST READ**: [docs/references/data/README.md](docs/references/data/README.md) for system selection, architecture, and patterns.

| System                                                     | Use Case                            | APIs                                                       |
| ---------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| [BootConfig](docs/references/data/boot-config-overview.md) | Early boot settings (pre-lifecycle) | `bootConfigService.get()`, `usePreference('BootConfig.*')` |
| [Cache](docs/references/data/cache-overview.md)            | Temp data (can lose)                | `useCache`, `useSharedCache`, `usePersistCache`            |
| [Preference](docs/references/data/preference-overview.md)  | User settings                       | `usePreference`                                            |
| [DataApi](docs/references/data/data-api-overview.md)       | Business data (**critical**)        | `useQuery`, `useMutation`                                  |

Scope:

- **BootConfig**: sync file-based; direct in main (pre-lifecycle), via `usePreference('BootConfig.*')` otherwise
- **Cache**: memory / cross-window / persisted tiers; usable in main and renderer
- **Preference**: cross-process (main + renderer); auto-syncs across windows
- **DataApi**: SQLite-backed; no auto-sync, fetch on demand from renderer

Database: SQLite + Drizzle ORM, schemas in `src/main/data/db/schemas/`, migrations via `pnpm db:migrations:generate`

**DataApi boundary rule**: DataApi is for SQLite-backed business data only. No database table → no DataApi endpoint; use IPC instead. See [Scope & Boundaries](docs/references/data/api-design-guidelines.md#dataapi-scope--boundaries).

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
- **Use `this.registerDisposable()`** for cleanup tracking — accepts `Disposable` objects or `() => void` cleanup functions
- **Use `Emitter<T>` / `Event<T>`** for inter-service events, **`Signal<T>`** for one-shot completion
- **Implement `Activatable`** for services with heavy on-demand resources (IPC stays registered, resources load/release via `onActivate()`/`onDeactivate()`)
- **Do NOT** use `new` or manual singleton patterns — the container manages instantiation, ordering, and shutdown

For detailed code examples, see [Usage Guide](docs/references/lifecycle/lifecycle-usage.md). For migrating legacy services, see [Migration Guide](docs/references/lifecycle/lifecycle-migration-guide.md).

### Non-Lifecycle Services (Direct-Import Singleton)

Services without long-lived resources or persistent side effects: use **named export singleton** (`export const x = new X()`). No `getInstance()` patterns. See [Decision Guide](docs/references/lifecycle/lifecycle-decision-guide.md) for criteria.

## v2 Refactoring (In Progress)

### Data Layer

- **Removing**: Redux, Dexie
- **Adopting**: Cache / Preference / DataApi architecture (see [Data](#data))

### UI Layer

- **Prohibited**: antd, HeroUI, styled-components
- **Adopting**: `@cherrystudio/ui` (located in `packages/ui`, Tailwind CSS + Shadcn UI)

### Data Classification Toolchain

The `v2-refactor-temp/tools/data-classify/` directory is the code generation pipeline for the v2 data layer. `classification.json` is the single source of truth.

The following four files are **auto-generated — NEVER edit them by hand**:

- `packages/shared/data/preference/preferenceSchemas.ts`
- `packages/shared/data/bootConfig/bootConfigSchemas.ts`
- `src/main/data/migration/v2/migrators/mappings/PreferencesMappings.ts`
- `src/main/data/migration/v2/migrators/mappings/BootConfigMappings.ts`

To change any of them, edit `classification.json` or `target-key-definitions.json`, then regenerate:

```bash
cd v2-refactor-temp/tools/data-classify && npm run generate
```

## Security

- Never expose Node.js APIs directly to renderer; use `contextBridge` in preload
- Validate all IPC inputs in main process handlers
- URL sanitization via `strict-url-sanitise`
- IP validation via `ipaddr.js` (API server)
- `express-validator` for API server request validation
