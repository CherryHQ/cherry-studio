# AI Assistant Guide

This file provides guidance to AI coding assistants when working with code in this repository. Adherence to these guidelines is crucial for maintaining code quality and consistency.

## Guiding Principles (MUST FOLLOW)

- **Keep it clear**: Write code that is easy to read, maintain, and explain.
- **Match the house style**: Reuse existing patterns, naming, and conventions.
- **Search smart**: Prefer `ast-grep` for semantic queries; fall back to `rg`/`grep` when needed.
- **Build with Tailwind CSS & Shadcn UI**: Use components from `@packages/ui` (Shadcn UI + Tailwind CSS) for every new UI component; never add `antd` or `styled-components`.
- **Log centrally**: Route all logging through `loggerService` with the right context—no `console.log`.
- **Research via subagent**: Lean on `subagent` for external docs, APIs, news, and references.
- **Always propose before executing**: Before making any changes, clearly explain your planned approach and wait for explicit user approval to ensure alignment and prevent unwanted modifications.
- **Lint, test, and format before completion**: Coding tasks are only complete after running `yarn lint`, `yarn test`, and `yarn format` successfully.
- **Write conventional commits**: Commit small, focused changes using Conventional Commit messages (e.g., `feat:`, `fix:`, `refactor:`, `docs:`).

## Pull Request Workflow (CRITICAL)

When creating a Pull Request, you MUST:

1. **Read the PR template first**: Always read `.github/pull_request_template.md` before creating the PR
2. **Follow ALL template sections**: Structure the `--body` parameter to include every section from the template
3. **Never skip sections**: Include all sections even if marking them as N/A or "None"
4. **Use proper formatting**: Match the template's markdown structure exactly (headings, checkboxes, code blocks)

## Development Commands

- **Install**: `yarn install` - Install all project dependencies
- **Development**: `yarn dev` - Runs Electron app in development mode with hot reload
- **Debug**: `yarn debug` - Starts with debugging enabled, use `chrome://inspect` to attach debugger
- **Build Check**: `yarn build:check` - **REQUIRED** before commits (lint + test + typecheck)
  - If having i18n sort issues, run `yarn i18n:sync` first to sync template
  - If having formatting issues, run `yarn format` first
- **Test**: `yarn test` - Run all tests (Vitest) across main and renderer processes
- **Single Test**:
  - `yarn test:main` - Run tests for main process only
  - `yarn test:renderer` - Run tests for renderer process only
- **Lint**: `yarn lint` - Fix linting issues and run TypeScript type checking
- **Format**: `yarn format` - Auto-format code using Biome

## Project Architecture

### Electron Structure

- **Main Process** (`src/main/`): Node.js backend with services (MCP, Knowledge, Storage, etc.)
- **Renderer Process** (`src/renderer/`): React UI
- **Preload Scripts** (`src/preload/`): Secure IPC bridge

### Key Architectural Components

#### Data Management

**MUST READ**: [docs/en/references/data/README.md](docs/en/references/data/README.md) for system selection, architecture, and patterns.

| System     | Use Case                     | APIs                                            |
| ---------- | ---------------------------- | ----------------------------------------------- |
| Cache      | Temp data (can lose)         | `useCache`, `useSharedCache`, `usePersistCache` |
| Preference | User settings                | `usePreference`                                 |
| DataApi    | Business data (**critical**) | `useQuery`, `useMutation`                       |

Database: SQLite + Drizzle ORM, schemas in `src/main/data/db/schemas/`, migrations via `yarn db:migrations:generate`

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

### Key Patterns

- **IPC Communication**: Secure main-renderer communication via preload scripts
- **Service Layer**: Clear separation between UI and business logic
- **Plugin Architecture**: Extensible via MCP servers and middleware
- **Multi-language Support**: i18n with dynamic loading
- **Theme System**: Light/dark themes with custom CSS variables

## v2 Refactoring (In Progress)

The v2 branch is undergoing a major refactoring effort:

### Data Layer

- **Removing**: Redux, Dexie
- **Adopting**: Cache / Preference / DataApi architecture (see [Data Management](#data-management))

### UI Layer

- **Removing**: antd, HeroUI, styled-components
- **Adopting**: `@cherrystudio/ui` (located in `packages/ui`, Tailwind CSS + Shadcn UI)
- **Prohibited**: antd, HeroUI, styled-components

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
// Renderer: loggerService.initWindowSource('windowName') first
logger.info("message", CONTEXT);
```
