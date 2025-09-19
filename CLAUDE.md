# AI Assistant Guide

This file provides guidance to AI coding assistants when working with code in this repository. Adherence to these guidelines is crucial for maintaining code quality and consistency.

## Guiding Principles

- **Clarity and Simplicity**: Write code that is easy to understand and maintain.
- **Consistency**: Follow existing patterns and conventions in the codebase.
- **Correctness**: Ensure code is correct, well-tested, and robust.
- **Efficiency**: Write performant code and use resources judiciously.

## MUST Follow Rules

1.  **Code Search**: Use `ast-grep` for semantic code pattern searches when available. Fallback to `rg` (ripgrep) or `grep` for text-based searches.
2.  **UI Framework**: Exclusively use **HeroUI** for all new UI components. The use of `antd` or `styled-components` is strictly **PROHIBITED**.
3.  **Quality Assurance**: **Always** run `yarn build:check` before finalizing your work or making any commits. This ensures code quality (linting, testing, and type checking).
4.  **Centralized Logging**: Use the `loggerService` exclusively for all application logging (info, warn, error levels) with proper context. Do not use `console.log`.
5.  **External Research**: Leverage `subagent` for gathering external information, including latest documentation, API references, news, or web-based research. This keeps the main conversation focused on the task at hand.
6.  **Code Reviews**: Always seek a code review from a human developer before merging significant changes. This ensures adherence to project standards and catches potential issues.
7.  **Documentation**: Update or create documentation for any new features, modules, or significant changes to existing functionality.

## Development Commands

- **Install**: `yarn install`
- **Development**: `yarn dev` - Runs Electron app in development mode
- **Debug**: `yarn debug` - Starts with debugging enabled, use chrome://inspect
- **Build Check**: `yarn build:check` - REQUIRED before commits (lint + test + typecheck)
- **Test**: `yarn test` - Run all tests (Vitest)
- **Single Test**: `yarn test:main` or `yarn test:renderer`
- **Lint**: `yarn lint` - Fix linting issues and run typecheck

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
- **UI Components**: HeroUI (`@heroui/*`) for all new UI elements.

### Logging
```typescript
import { loggerService } from '@logger'
const logger = loggerService.withContext('moduleName')
// Renderer: loggerService.initWindowSource('windowName') first
logger.info('message', CONTEXT)
```
