# AI Assistant Guide

This file provides guidance to AI coding assistants when working with code in this repository. Adherence to these guidelines is crucial for maintaining code quality and consistency.

## Guiding Principles (MUST FOLLOW)

- **Keep it clear**: Write code that is easy to read, maintain, and explain.
- **Match the house style**: Reuse existing patterns, naming, and conventions.
- **Search smart**: Prefer `ast-grep` for semantic queries; fall back to `rg`/`grep` when needed.
- **Build with Tailwind CSS & Shadcn UI**: Use components from `@packages/ui` (Shadcn UI + Tailwind CSS) for every new UI component; never add `antd` or `styled-components`.
- **Log centrally**: Route all logging through `loggerService` with the right context—no `console.log`.
- **Access paths centrally**: Use `application.getPath('namespace.key', filename?)` for all main-process filesystem paths—never call `app.getPath()`, `os.homedir()`, or construct paths ad-hoc. Import the singleton via `import { application } from '@application'`.
- **Research via subagent**: Lean on `subagent` for external docs, APIs, news, and references.
- **Always propose before executing**: Before making any changes, clearly explain your planned approach and wait for explicit user approval to ensure alignment and prevent unwanted modifications.
- **Lint, test, and format before completion**: Coding tasks are only complete after running `pnpm lint`, `pnpm test`, and `pnpm format` successfully.
- **Write conventional commits**: Commit small, focused changes using Conventional Commit messages (e.g., `feat:`, `fix:`, `refactor:`, `docs:`).
- **Sign commits**: Use `git commit --signoff` as required by contributor guidelines.

## Pull Request Workflow (CRITICAL)

When creating a Pull Request, you MUST use the `gh-create-pr` skill.
If the skill is unavailable, directly read `.agents/skills/gh-create-pr/SKILL.md` and follow it manually.

## Review Workflow

When reviewing a Pull Request, do NOT run `pnpm lint`, `pnpm test`, or `pnpm format` locally.
Instead, check CI status directly using GitHub CLI:

- **Check CI status**: `gh pr checks <PR_NUMBER>` - View all CI check results for the PR
- **Check PR details**: `gh pr view <PR_NUMBER>` - View PR status, reviews, and merge readiness
- **View failed logs**: `gh run view <RUN_ID> --log-failed` - Inspect logs for failed CI runs

Only investigate CI failures by reading the logs, not by re-running checks locally.

## Issue Workflow

When creating an Issue, you MUST use the `gh-create-issue` skill.
If the skill is unavailable, directly read `.agents/skills/gh-create-issue/SKILL.md` and follow it manually.

### Branch Strategy (Effective April 3, 2026)

> **IMPORTANT**: The `main` branch is now under **code freeze**. Only critical bug fixes submitted via `hotfix/*` branches are accepted. Fix PRs must be minimal in scope and must not include any refactoring code.
>
> All new features, refactoring, and optimizations should be developed on the **`v2` branch**. We welcome every developer to actively participate in v2 development!
>
> The `v2` branch will only accept new feature submissions after all current features have been fully refactored.

## Development Commands

- **Install**: `pnpm install` — Install all project dependencies (requires Node ≥22, pnpm 10.27.0)
- **Development**: `pnpm dev` — Runs Electron app in development mode with hot reload
- **Debug**: `pnpm debug` — Starts with debugging; attach via `chrome://inspect` on port 9222
- **Build Check**: `pnpm build:check` — **REQUIRED** before commits (`pnpm lint && pnpm test`)
  - If having i18n sort issues, run `pnpm i18n:sync` first
  - If having formatting issues, run `pnpm format` first
- **Full Build**: `pnpm build` — TypeScript typecheck + electron-vite build
- **Test**: `pnpm test` — Run all Vitest tests (main + renderer + aiCore + shared + scripts)
  - `pnpm test:main` — Main process tests only (Node environment)
  - `pnpm test:renderer` — Renderer process tests only (jsdom environment)
  - `pnpm test:aicore` — aiCore package tests only
  - `pnpm test:watch` — Watch mode
  - `pnpm test:coverage` — With v8 coverage report
  - `pnpm test:e2e` — Playwright end-to-end tests
- **Lint**: `pnpm lint` — oxlint + eslint fix + TypeScript typecheck + i18n check + format check
- **Format**: `pnpm format` — Biome format + lint (write mode)
- **Typecheck**: `pnpm typecheck` — Concurrent node + web TypeScript checks using `tsgo`
- **i18n**:
  - `pnpm i18n:sync` — Sync i18n template keys
  - `pnpm i18n:translate` — Auto-translate missing keys
  - `pnpm i18n:check` — Validate i18n completeness
- **Bundle Analysis**: `pnpm analyze:renderer` / `pnpm analyze:main` — Visualize bundle sizes
- **Agents DB**:
  - `pnpm agents:generate` — Generate Drizzle migrations
  - `pnpm agents:push` — Push schema to SQLite DB
  - `pnpm agents:studio` — Open Drizzle Studio

## Project Architecture

### Electron Structure

- **Main Process** (`src/main/`): Node.js backend with services (MCP, Knowledge, Storage, etc.)
- **Renderer Process** (`src/renderer/`): React UI
- **Preload Scripts** (`src/preload/`): Secure IPC bridge

### Key Architectural Components

#### Data Management

**MUST READ**: [docs/references/data/README.md](docs/references/data/README.md) for system selection, architecture, and patterns.

| System     | Use Case                        | APIs                                            |
| ---------- | ------------------------------- | ----------------------------------------------- |
| BootConfig | Early boot settings (pre-lifecycle) | `bootConfigService.get()`, `usePreference('BootConfig.*')` |
| Cache      | Temp data (can lose)            | `useCache`, `useSharedCache`, `usePersistCache` |
| Preference | User settings                   | `usePreference`                                 |
| DataApi    | Business data (**critical**)    | `useQuery`, `useMutation`                       |

Database: SQLite + Drizzle ORM, schemas in `src/main/data/db/schemas/`, migrations via `yarn db:migrations:generate`

**DataApi boundary rule**: DataApi is for SQLite-backed business data only. No database table → no DataApi endpoint; use IPC instead. See [Scope & Boundaries](docs/references/data/api-design-guidelines.md#dataapi-scope--boundaries).

### Build System

- **Electron-Vite**: Development and build tooling (v4.0.0)
- **Rolldown-Vite**: Using experimental rolldown-vite instead of standard vite
- **Workspaces**: Monorepo structure with `packages/` directory
- **Multiple Entry Points**: Main app, mini window, selection toolbar
- **Styled Components**: CSS-in-JS styling with SWC optimization

### Testing Strategy

- **Vitest**: Unit and integration testing
- **Playwright**: End-to-end testing
- **Component Testing**: React Testing Library
- **Coverage**: Available via `yarn test:coverage`

#### Main Process Services (Lifecycle)

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

#### Non-Lifecycle Services (Direct-Import Singleton)

Services without long-lived resources or persistent side effects: use **named export singleton** (`export const x = new X()`). No `getInstance()` patterns. See [Decision Guide](docs/references/lifecycle/lifecycle-decision-guide.md) for criteria.

### Key Patterns

- **IPC Communication**: Secure main-renderer communication via preload scripts
- **Service Layer**: Clear separation between UI and business logic
- **Plugin Architecture**: Extensible via MCP servers and middleware
- **Multi-language Support**: i18n with dynamic loading
- **Theme System**: Light/dark themes with custom CSS variables


### Design Specifications

When generating or modifying any UI component or page styles, you MUST first read the [Design Principle](./DESIGN.md) in the project root directory, strictly follow the colors, fonts, spacing, and component specifications defined therein, and must not use styles outside the specifications.

## v2 Refactoring (In Progress)

The `main` branch is under code freeze. All development has moved to the `v2` branch.

- **`main` branch**: Only accepts critical bug fixes via `hotfix/*` branches. Minimal changes, no refactoring.
- **`v2` branch**: All new features, refactoring, and optimizations go here.

Files marked with the following header are **blocked for feature changes** (bug fixes only):

```typescript
/**
 * @deprecated Scheduled for removal in v2.0.0
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 */
```

The v2 branch is undergoing a major refactoring effort:

### Data Layer

- **Removing**: Redux, Dexie
- **Adopting**: Cache / Preference / DataApi architecture (see [Data Management](#data-management))

### UI Layer

- **Removing**: antd, HeroUI, styled-components
- **Adopting**: `@cherrystudio/ui` (located in `packages/ui`, Tailwind CSS + Shadcn UI)
- **Prohibited**: antd, HeroUI, styled-components

### Data Classification Toolchain

The `v2-refactor-temp/tools/data-classify/` directory contains the code generation pipeline for the v2 data layer. `classification.json` is the single source of truth.

**Rule**: After modifying `classification.json` or `target-key-definitions.json`, you **MUST** run:

```bash
cd v2-refactor-temp/tools/data-classify && npm run generate
```

This regenerates the following TypeScript files:
- `packages/shared/data/preference/preferenceSchemas.ts`
- `packages/shared/data/bootConfig/bootConfigSchemas.ts`
- `src/main/data/migration/v2/migrators/mappings/PreferencesMappings.ts`
- `src/main/data/migration/v2/migrators/mappings/BootConfigMappings.ts`

### File Naming Convention

During migration, use `*.v2.ts` suffix for files not yet fully migrated:

- Indicates work-in-progress refactoring
- Avoids conflicts with existing code
- **Post-completion**: These files will be renamed or merged into their final locations

## Logging Standards

### Usage

```typescript
import { loggerService } from "@logger";
const logger = loggerService.withContext("moduleName");
// Renderer only: loggerService.initWindowSource('windowName') first
logger.info("message", CONTEXT);
logger.warn("message");
logger.error("message", error);
```

- Backend: Winston with daily log rotation
- Log files at the platform-standard location via `app.getPath('logs')` (e.g., `~/Library/Logs/<App>/` on macOS)
- Never use `console.log` — always use `loggerService`

### Tracing (OpenTelemetry)

- `packages/mcp-trace/` provides trace-core and trace-node/trace-web adapters
- `NodeTraceService` exports spans via OTLP HTTP
- `SpanCacheService` caches span entities for the trace viewer window
- IPC calls can carry span context via `tracedInvoke()`

## Path Management

`application.getPath('namespace.key', filename?)` is the sole entry point for all main-process filesystem paths. Never call `app.getPath()`, `os.homedir()`, or construct paths ad-hoc.

**MUST READ**: [src/main/core/paths/README.md](src/main/core/paths/README.md) — namespaces, naming, adding new keys, testing patterns.

## Tech Stack

| Layer         | Technologies                                         |
| ------------- | ---------------------------------------------------- |
| Runtime       | Electron 38, Node ≥22                                |
| Frontend      | React 19, TypeScript ~5.8                            |
| UI            | Ant Design 5.27, styled-components 6, TailwindCSS v4 |
| State         | Redux Toolkit, redux-persist, Dexie (IndexedDB)      |
| Rich Text     | TipTap 3.2 (with Yjs collaboration)                  |
| AI SDK        | Vercel AI SDK v5 (`ai`), `@cherrystudio/ai-core`     |
| Build         | electron-vite 5 with rolldown-vite 7 (experimental)  |
| Test          | Vitest 3 (unit), Playwright (e2e)                    |
| Lint/Format   | ESLint 9, oxlint, Biome 2                            |
| DB (main)     | Drizzle ORM + LibSQL (SQLite)                        |
| DB (renderer) | Dexie (IndexedDB)                                    |
| Logging       | Winston + winston-daily-rotate-file                  |
| Tracing       | OpenTelemetry                                        |
| i18n          | i18next + react-i18next                              |

## Conventions

### TypeScript

- Strict mode enabled; use `tsgo` (native TypeScript compiler preview) for typechecking
- Separate configs: `tsconfig.node.json` (main), `tsconfig.web.json` (renderer)
- Type definitions centralized in `src/renderer/src/types/` and `packages/shared/`

### Code Style

- Biome handles formatting (2-space indent, single quotes, trailing commas)
- oxlint + ESLint for linting; `simple-import-sort` enforces import order
- React hooks: `eslint-plugin-react-hooks` enforced
- No unused imports: `eslint-plugin-unused-imports`

### File Naming

- React components: `PascalCase.tsx`
- Services, hooks, utilities: `camelCase.ts`
- Test files: `*.test.ts` or `*.spec.ts` alongside source or in `__tests__/` subdirectory

### i18n

- All user-visible strings must use `i18next` — never hardcode UI strings
- Run `pnpm i18n:check` to validate; `pnpm i18n:sync` to add missing keys
- Locale files in `src/renderer/src/i18n/`

### Packages with Custom Patches

Several dependencies have patches in `patches/` — be careful when upgrading:
- `antd`, `@ai-sdk/google`, `@ai-sdk/openai`, `@anthropic-ai/vertex-sdk`
- `@google/genai`, `@langchain/core`, `@langchain/openai`
- `ollama-ai-provider-v2`, `electron-updater`, `epub`, `tesseract.js`
- `@anthropic-ai/claude-agent-sdk`

## Testing Guidelines

- Tests use Vitest 3 with project-based configuration
- Main process tests: Node environment, `tests/main.setup.ts`
- Renderer tests: jsdom environment, `tests/renderer.setup.ts`, `@testing-library/react`
- aiCore tests: separate `packages/aiCore/vitest.config.ts`
- All tests run without CI dependency (fully local)
- Coverage via v8 provider (`pnpm test:coverage`)
- **Features without tests are not considered complete**
- **Test Mocking**: Use the unified mock system — do NOT create ad-hoc mocks for `application`, services, or data layers. See [tests/__mocks__/README.md](tests/__mocks__/README.md) for available mocks, usage patterns, and best practices.
- **Database Tests**: For any service/handler/seeder that reads or writes SQLite, use `setupTestDatabase()` from `@test-helpers/db` — it provides a real file-backed DB with production migrations. Do NOT hand-write `CREATE TABLE` SQL, override `@application`, or stub Drizzle chains. See [docs/references/testing/database-testing.md](docs/references/testing/database-testing.md).

## Important Notes

### Security

- Never expose Node.js APIs directly to renderer; use `contextBridge` in preload
- Validate all IPC inputs in main process handlers
- URL sanitization via `strict-url-sanitise`
- IP validation via `ipaddr.js` (API server)
- `express-validator` for API server request validation
