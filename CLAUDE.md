# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Environment Setup

- **Prerequisites**: Node.js v22.x.x or higher, Yarn 4.9.1
- **Setup Yarn**: `corepack enable && corepack prepare yarn@4.9.1 --activate`
- **Install Dependencies**: `yarn install`
- **Add New Dependencies**: `yarn add -D` for renderer-specific dependencies, `yarn add` for others.

### Development

- **Start Development**: `yarn dev` - Runs Electron app in development mode
- **Debug Mode**: `yarn debug` - Starts with debugging enabled, use chrome://inspect

### Testing & Quality

- **Run Tests**: `yarn test` - Runs all tests (Vitest)
- **Run E2E Tests**: `yarn test:e2e` - Playwright end-to-end tests
- **Type Check**: `yarn typecheck` - Checks TypeScript for both node and web
- **Lint**: `yarn lint` - ESLint with auto-fix
- **Format**: `yarn format` - Biome formatting

### Build & Release

- **Build**: `yarn build` - Builds for production (includes typecheck)
- **Platform-specific builds**:
  - Windows: `yarn build:win`
  - macOS: `yarn build:mac`
  - Linux: `yarn build:linux`

## Architecture Overview

### Electron Multi-Process Architecture

- **Main Process** (`src/main/`): Node.js backend handling system integration, file operations, and services
- **Renderer Process** (`src/renderer/`): React-based UI running in Chromium
- **Preload Scripts** (`src/preload/`): Secure bridge between main and renderer processes

### Key Architectural Components

#### Main Process Services (`src/main/services/`)

- **MCPService**: Model Context Protocol server management
- **KnowledgeService**: Document processing and knowledge base management
- **FileStorage/S3Storage/WebDav**: Multiple storage backends
- **WindowService**: Multi-window management (main, mini, selection windows)
- **ProxyManager**: Network proxy handling
- **SearchService**: Full-text search capabilities

#### AI Core (`src/renderer/src/aiCore/`)

- **Middleware System**: Composable pipeline for AI request processing
- **Client Factory**: Supports multiple AI providers (OpenAI, Anthropic, Gemini, etc.)
- **Stream Processing**: Real-time response handling

#### Data Management

- **Cache System**: Three-layer caching (memory/shared/persist) with React hooks integration
- **Preferences**: Type-safe configuration management with multi-window synchronization
- **User Data**: SQLite-based storage with Drizzle ORM for business data

#### Knowledge Management

- **Embeddings**: Vector search with multiple providers (OpenAI, Voyage, etc.)
- **OCR**: Document text extraction (system OCR, Doc2x, Mineru)
- **Preprocessing**: Document preparation pipeline
- **Loaders**: Support for various file formats (PDF, DOCX, EPUB, etc.)

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

### UI Design

The project is in the process of migrating from antd & styled-components to HeroUI. Please use HeroUI to build UI components. The use of antd and styled-components is prohibited.

HeroUI Docs: https://www.heroui.com/docs/guide/introduction

### Database Architecture

- **Database**: SQLite (`cherrystudio.sqlite`) + libsql driver
- **ORM**: Drizzle ORM with comprehensive migration system
- **Schemas**: Located in `src/main/data/db/schemas/` directory

#### Database Standards

- **Table Naming**: Use singular form with snake_case (e.g., `topic`, `message`, `app_state`)
- **Schema Exports**: Export using `xxxTable` pattern (e.g., `topicTable`, `appStateTable`)
- **Field Definition**: Drizzle auto-infers field names, no need to add default field names
- **JSON Fields**: For JSON support, add `{ mode: 'json' }`, refer to `preference.ts` table definition
- **JSON Serialization**: For JSON fields, no need to manually serialize/deserialize when reading/writing to database, Drizzle handles this automatically
- **Timestamps**: Use existing `crudTimestamps` utility
- **Migrations**: Generate via `yarn run migrations:generate`

## Data Access Patterns

The application uses three distinct data management systems. Choose the appropriate system based on data characteristics:

### Cache System
- **Purpose**: Temporary data that can be regenerated
- **Lifecycle**: Component-level (memory), window-level (shared), or persistent (survives restart)
- **Use Cases**: API response caching, computed results, temporary UI state
- **APIs**: `useCache`, `useSharedCache`, `usePersistCache` hooks, or `cacheService`

### Preference System
- **Purpose**: User configuration and application settings
- **Lifecycle**: Permanent until user changes
- **Use Cases**: Theme, language, editor settings, user preferences
- **APIs**: `usePreference`, `usePreferences` hooks, or `preferenceService`

### User Data API
- **Purpose**: Core business data (conversations, files, notes, etc.)
- **Lifecycle**: Permanent business records
- **Use Cases**: Topics, messages, files, knowledge base, user-generated content
- **APIs**: `useDataApi` hook or `dataApiService` for direct calls

### Selection Guidelines

- **Use Cache** for data that can be lost without impact (computed values, API responses)
- **Use Preferences** for user settings that affect app behavior (UI configuration, feature flags)
- **Use User Data API** for irreplaceable business data (conversations, documents, user content)

## Logging Standards

### Usage

```typescript
// Main process
import { loggerService } from '@logger'
const logger = loggerService.withContext('moduleName')

// Renderer process (set window source first)
loggerService.initWindowSource('windowName')
const logger = loggerService.withContext('moduleName')

// Logging
logger.info('message', CONTEXT)
logger.error('message', new Error('error'), CONTEXT)
```

### Log Levels (highest to lowest)

- `error` - Critical errors causing crash/unusable functionality
- `warn` - Potential issues that don't affect core functionality
- `info` - Application lifecycle and key user actions
- `verbose` - Detailed flow information for feature tracing
- `debug` - Development diagnostic info (not for production)
- `silly` - Extreme debugging, low-level information
