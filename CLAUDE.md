# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Install**: `yarn install`
- **Development**: `yarn dev` - Runs Electron app in development mode
- **Debug**: `yarn debug` - Starts with debugging enabled, use chrome://inspect
- **Build Check**: `yarn build:check` - REQUIRED before commits (lint + test + typecheck)
- **Test**: `yarn test` - Run all tests (Vitest)
- **Single Test**: `yarn test:main` or `yarn test:renderer`
- **Lint**: `yarn lint` - Fix linting issues and run typecheck

## Architecture

### Electron Structure
- **Main Process** (`src/main/`): Node.js backend with services (MCP, Knowledge, Storage, etc.)
- **Renderer Process** (`src/renderer/`): React UI with Redux state management
- **Preload Scripts** (`src/preload/`): Secure IPC bridge

### Key Components
- **AI Core** (`src/renderer/src/aiCore/`): Middleware pipeline for multiple AI providers
- **Services** (`src/main/services/`): MCPService, KnowledgeService, WindowService, etc.
- **Build System**: Electron-Vite with experimental rolldown-vite, yarn workspaces

### Logging
```typescript
import { loggerService } from '@logger'
const logger = loggerService.withContext('moduleName')
// Renderer: loggerService.initWindowSource('windowName') first
logger.info('message', CONTEXT)
```

## Session Tracking

When working in plan mode, Claude Code MUST:

1. **Create Session File**: Create a markdown file in `.sessions/` folder with format:
   `YYYY-MM-DD-HH-MM-SS-<feature-name>.md`

2. **Track Progress**: After each code patch or significant change, update the session file with:
   - What was changed
   - Files modified
   - Decisions made
   - Next steps

3. **Keep Updated**: The session file must remain current throughout the entire development session

## Must Follow Rules

1. **Search Code**: Use `ast-grep` for code pattern searches if available, otherwise use `rg` or `grep` for text-based searches
2. **UI Components**: Use HeroUI for new components - antd and styled-components are PROHIBITED
3. **Quality Gate**: Run `yarn build:check` before any commits
4. **Session Documentation**: Maintain session tracking file when in plan mode
