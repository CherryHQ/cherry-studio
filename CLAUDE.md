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
- **Follow PR template**: When submitting pull requests, follow the template in `.github/pull_request_template.md` to ensure complete context and documentation.

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

The project is in the process of migrating from antd & styled-components to Tailwind CSS and Shadcn UI. Please use components from `@packages/ui` to build UI components. The use of antd and styled-components is prohibited.

UI Library: `@packages/ui`

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
import { loggerService } from '@logger'
const logger = loggerService.withContext('moduleName')
// Renderer: loggerService.initWindowSource('windowName') first
logger.info('message', CONTEXT)
```
