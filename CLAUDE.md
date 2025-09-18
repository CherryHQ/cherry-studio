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
4.  **Session Tracking Documentation**: MUST Consistently maintain the session SDLC log file following the template structure outlined in the Session Tracking section.
5.  **Centralized Logging**: Use the `loggerService` exclusively for all application logging (info, warn, error levels) with proper context. Do not use `console.log`.
6.  **External Research**: Leverage `subagent` for gathering external information, including latest documentation, API references, news, or web-based research. This keeps the main conversation focused on the task at hand.

## Session Tracking Protocol

Purpose: keep a living SDLC record so any coding agent can pause or resume work without losing momentum.

### When to Log
- Start a new file when kicking off a feature or major task branch.
- Append to the existing file whenever you switch focus, finish a task, encounter a blocker, or hand over.
- If you resume someone else's session, add a new patch log entry summarizing what you picked up and what remains.

### File Naming
- `.sessions/YYYYMMDD-<feature>.md`
- Example: `.sessions/20250916-agent-onboarding.md`

### Template
```md
# <feature> — SDLC Session (<YYYY-MM-DD>)

## Session Metadata
- Participants:
- Repo state / branch:
- Related tickets / docs:
- Links to prior sessions:

## Design Brief
- Problem & goals:
- Non-goals / scope:
- Constraints & risks:
- Acceptance criteria:

## Solution Plan
- Architecture / flow:
- Key interfaces or modules:
- Data considerations:
- Test strategy:

## Work Plan
| ID  | Task | Owner | Depends | Est | Status | Notes |
| --- | ---- | ----- | ------- | --- | ------ | ----- |
| T1  |      |       |         |     | TODO   |       |

_Status values: TODO, IN PROGRESS, BLOCKED, DONE. Update estimates as work evolves._

## Execution Log
### <YYYY-MM-DD HH:MM>
- Activity summary (what changed, decisions made)
- Artifacts (PRs, commits, file paths, specs)
- Tests / Commands run:
- Issues / Risks:
- Next focus before handoff:

_Append a new timestamped block for each meaningful work segment._

## Handoff Checklist
- [ ] Remaining work captured in Work Plan
- [ ] Blockers / questions called out
- [ ] Links to diffs / PRs / relevant artifacts
- [ ] Next session entry point documented

## Validation
- [ ] Acceptance criteria met
- [ ] `yarn build:check` passes
- [ ] Tests required by strategy green
- [ ] Docs / tickets updated (if applicable)
```

### Usage Example
```
### 2025-09-16 18:40
- Activity: Finished wiring HeroUI settings panel skeleton; left TODO for data bindings.
- Artifacts: src/renderer/.../SettingsPanel.tsx, PR #1234 (draft).
- Tests / Commands: yarn lint
- Issues / Risks: Waiting on API schema (#456).
- Next focus: Bind `updateSettings` once API lands; run yarn build:check before flip to PR.
```


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
