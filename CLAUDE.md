# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## neucleos Overview

neucleos is a cross-platform Electron desktop application that provides a powerful AI assistant interface supporting multiple LLM providers. The project uses a modern tech stack with TypeScript, React, Redux Toolkit, and Vite.

## Development Commands

### Running the Application

- `yarn dev`: Start development server with hot reload (port 5173)
- `yarn dev:safe`: Check port availability before starting (recommended)
- `yarn debug`: Start with debugging enabled (use `--inspect` and remote debugging on port 9222)

### Building

- `yarn build`: Build for current platform (runs typecheck first)
- `yarn build:check`: Full build validation (typecheck + i18n + tests)
- `yarn build:win`: Build for Windows (both x64 and arm64)
- `yarn build:mac`: Build for macOS (both x64 and arm64)
- `yarn build:linux`: Build for Linux platforms

### Testing

- `yarn test`: Run all tests (main + renderer)
- `yarn test:main`: Test main process only
- `yarn test:renderer`: Test renderer process only
- `yarn test:coverage`: Generate test coverage report (v8 provider)
- `yarn test:e2e`: Run Playwright end-to-end tests
- `yarn test:watch`: Run tests in watch mode for TDD
- `yarn test:ui`: Open Vitest UI for interactive testing
- `yarn test:update`: Update test snapshots

### Code Quality

- `yarn lint`: Run ESLint checks and auto-fix
- `yarn format`: Format code with Prettier
- `yarn typecheck`: Run TypeScript type checking (both node and web)
- `yarn typecheck:node`: TypeScript checking for main process
- `yarn typecheck:web`: TypeScript checking for renderer
- `yarn check:i18n`: Validate internationalization
- `yarn analyze:renderer`: Analyze renderer bundle size
- `yarn analyze:main`: Analyze main process bundle size

## Important Recent Changes (2025-01-27)

### Firebase/Supabase Removal

- All Firebase authentication and Supabase integration code has been removed from the main branch
- The clean codebase is on `main` branch, old code is preserved in `old-main-with-firebase`
- Environment variables for Supabase in `.env.example` are no longer used

### Tab System Navigation Pattern

Settings navigation and other singleton pages now require coordinated navigation between the tab system and React Router:

```typescript
// CORRECT: Use tab system for navigation
const navigateToSettings = (route: string) => {
  const activeTab = tabs.find((t) => t.route.startsWith('/settings'))
  if (activeTab) {
    dispatch(updateTabRoute({ id: activeTab.id, route }))
    navigate(route)
  }
}

// INCORRECT: Direct navigation (causes new tabs)
navigate('/settings/provider') // ❌ Don't do this
```

### Known Issues to Address

- **Inputbar Components**: Some components (`WebSearchButton`, `MentionModelsButton`, `MCPToolsButton`) still use direct navigation
- **MCP Settings Navigation**: Components in `src/renderer/src/pages/settings/MCPSettings/` need tab system integration

## High-Level Architecture

### Multi-Process Architecture

neucleos follows Electron's multi-process architecture:

1. **Main Process** (`src/main/`): Node.js environment handling OS integration
   - `index.ts`: Application entry point, window management, IPC setup
   - `services/`: Core services (WindowService, MCPService, StorageService)
   - `embeddings/`: Text embedding implementations for AI features
   - `reranker/`: Document reranking functionality
   - `mcpServers/`: MCP (Model Context Protocol) server implementations

2. **Renderer Process** (`src/renderer/`): React application
   - `aiCore/`: AI provider integrations (OpenAI, Anthropic, Google, etc.)
   - `pages/`: Main application pages (Home, Chat, Settings)
   - `store/`: Redux store with slices for state management
   - `services/`: Frontend services for API communication

3. **Preload Scripts** (`src/preload/`): Secure bridge between processes
   - Exposes safe APIs to renderer via `window.api`
   - Handles IPC communication security

### Key Architectural Patterns

1. **Window Management**: Multiple window types (main, mini, selection toolbar)
   - WindowService handles creation, positioning, and lifecycle
   - Each window type has dedicated HTML entry point

2. **AI Integration Layer**:
   - Unified client interface for multiple LLM providers
   - Middleware system for response processing
   - Web search and knowledge base integration

3. **Storage Architecture**:
   - Local file storage with optional encryption
   - WebDAV support for remote synchronization
   - Separate stores for configuration, sessions, and knowledge bases

4. **State Management**:
   - Redux Toolkit for global state
   - React hooks for local component state
   - IPC for cross-process state synchronization
   - Tab system requires special handling for navigation (use `updateTabRoute`)

### Path Aliases

The project uses TypeScript path aliases for cleaner imports:

- `@main/*`: Main process modules
- `@renderer/*`: Renderer process modules
- `@shared/*`: Shared types and utilities

### Testing Strategy

- **Unit Tests**: Vitest with workspace configuration for separate main/renderer testing
- **E2E Tests**: Playwright for user workflow testing
- **Test Location**: Tests co-located with source files as `*.test.ts(x)`
- **Coverage**: V8 provider with comprehensive exclusions

### Development Workflow

1. **Feature Development**:
   - Create feature branch from main
   - Run `yarn dev:safe` for development
   - Use `yarn test:watch` for TDD approach
   - Ensure `yarn typecheck` passes before commit

2. **Cross-Process Communication**:
   - Define IPC channels in main process
   - Expose safe methods via preload
   - Use type-safe IPC handlers

3. **AI Provider Integration**:
   - Implement provider client in `aiCore/`
   - Add middleware if needed for response processing
   - Update provider configuration in settings

4. **Multi-Window Features**:
   - Define window configuration in WindowService
   - Create dedicated HTML entry if needed
   - Handle window-specific IPC channels

### Pre-commit Hooks

The project uses husky with lint-staged to format code automatically:

- JavaScript/TypeScript files: Prettier + ESLint
- JSON/Markdown/YAML/CSS/HTML: Prettier

### Current Development Focus

- Selection Assistant feature
- Deep Research capabilities
- Memory System implementation
- Plugin system architecture
- Voice features (ASR/TTS integration)

## Project Configuration Files

- `electron.vite.config.ts`: Build configuration for all processes
- `tsconfig.*.json`: TypeScript configurations (node/web environments)
- `.eslintrc.cjs`: ESLint rules with TypeScript and React plugins
- `electron-builder.yml`: Platform-specific build configurations
- `playwright.config.ts`: E2E test configuration
- `vitest.config.ts`: Test configuration with workspace setup

## Git Branch Status

- **Current branch**: main (clean, stable version without Firebase/Supabase)
- **Important tags**: `stable-2025-01-27-settings-fixed`
- **Recovery branch**: `old-main-with-firebase` (contains removed authentication code)

## Additional Resources

- `CURRENT_STATE_2025-01-27.md`: Detailed status of recent fixes and changes
- `docs/`: Architecture and development documentation
- `README.md`: Public-facing project information and setup instructions
