# AI Assistant Guide

This file provides guidance to AI coding assistants when working with code in this repository. Adherence to these guidelines is crucial for maintaining code quality and consistency.

## Guiding Principles (MUST FOLLOW)

- **Keep it clear**: Write code that is easy to read, maintain, and explain.
- **Match the house style**: Reuse existing patterns, naming, and conventions.
- **Search smart**: Prefer `ast-grep` for semantic queries; fall back to `rg`/`grep` when needed.
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
  - If having i18n sort issues, run `yarn sync:i18n` first to sync template
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
- **Renderer Process** (`src/renderer/`): React UI with Redux state management
- **Preload Scripts** (`src/preload/`): Secure IPC bridge

### Key Components
- **AI Core** (`src/renderer/src/aiCore/`): Middleware pipeline for multiple AI providers.
- **Services** (`src/main/services/`): MCPService, KnowledgeService, WindowService, etc.
- **Build System**: Electron-Vite with experimental rolldown-vite, yarn workspaces.
- **State Management**: Redux Toolkit (`src/renderer/src/store/`) for predictable state.

### Logging
```typescript
import { loggerService } from '@logger'
const logger = loggerService.withContext('moduleName')
// Renderer: loggerService.initWindowSource('windowName') first
logger.info('message', CONTEXT)
```
