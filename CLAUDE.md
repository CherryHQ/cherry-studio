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
- **Renderer Process** (`src/renderer/`): React UI with Redux state management
- **Preload Scripts** (`src/preload/`): Secure IPC bridge

### Key Components

- **AI Core** (`src/renderer/src/aiCore/`): Middleware pipeline for multiple AI providers.
- **Services** (`src/main/services/`): MCPService, KnowledgeService, WindowService, etc.
- **Build System**: Electron-Vite with experimental rolldown-vite, yarn workspaces.
- **State Management**: Redux Toolkit (`src/renderer/src/store/`) for predictable state.

### Logging

```typescript
import { loggerService } from "@logger";
const logger = loggerService.withContext("moduleName");
// Renderer: loggerService.initWindowSource('windowName') first
logger.info("message", CONTEXT);
```

## Usage Panel Development Notes

### Naming and Routing

- Feature name: "Usage"
- Route: `/usage`
- Sidebar icon key: `usage`
- i18n label keys: `usage.title`, `usage.panel`, `usage.filters`, `usage.metrics`
- Chinese label: use codepoints U+7528 U+91CF in zh-cn translations

### Scope

- Include Chat, Agent, Translate, Knowledge (ingest/search/rerank), WebSearch RAG, and Paintings.
- Display dual cost columns in all summaries: provider cost and pricing cost.

### UsageEvent Data Model

- Core fields: `id`, `module`, `operation`, `occurredAt`, `providerId`, `modelId`, `modelName`, `category`.
- Usage fields: `promptTokens`, `completionTokens`, `totalTokens`, `usageSource`.
- Cost fields: `costProvider`, `costPricing`, `currencyProvider`, `currencyPricing`.
- References: `topicId`, `messageId`, `refType`, `refId`, plus optional `baseId`, `itemId`, `paintingId`.
- Pricing snapshot: store input/output price and currency at event time for stable history.
- Idempotency: deterministic IDs per module (e.g., `msg:${messageId}`, `translate:${historyId}`).
- Indexes: `occurredAt`, `module`, `category`, `providerId`, `modelId`, `topicId`.

### Ingestion Map

- Chat/Agent: `src/renderer/src/services/messageStreaming/callbacks/baseCallbacks.ts` on `onComplete`.
- Translate: `src/renderer/src/services/TranslateService.ts` listen for `ChunkType.BLOCK_COMPLETE`.
- Knowledge search/rerank: `src/renderer/src/services/KnowledgeService.ts`.
- Knowledge ingest: `src/renderer/src/queue/KnowledgeQueue.ts`.
- WebSearch RAG: `src/renderer/src/services/WebSearchService.ts` (track embedding/rerank activity).
- Paintings: provider pages under `src/renderer/src/pages/paintings/*` after successful generation.

### Cost Logic

- Provider cost: `usage.cost` when present (e.g., OpenRouter).
- Pricing cost: compute from model pricing snapshot; for images use per-image cost rules.
- Aggregate by currency; do not mix currencies in a single total.

### Analytics and Bucketing

- Query by `occurredAt` between user-selected range.
- Bucket by day/week/month/custom using `dayjs`.
- Category mapping: `language`, `multimodal`, `image_generation`, `embedding`, `rerank`, `web_search`.

### UI and Design Language

- Use existing antd + styled-components patterns and CSS variables.
- Avoid new fonts or heavy charting dependencies; prefer light SVG charts or existing components.
- Layout: filters row, KPI cards, trend charts, detail table with drill-down.

### Navigation Links (Cross-Module)

- Chat/Agent: locate message via `EventEmitter` using `topicId` and `messageId`.
- Translate: link to `/translate` with `historyId` for selection.
- Knowledge: link to `/knowledge` with `baseId` and `itemId`.
- Paintings: link to `/paintings/<provider>` with `paintingId`.

### Migration and Backfill

- Add `usage_events` Dexie table and version bump.
- Backfill Chat/Agent events from existing `topics.messages` where usage exists.
- Keep backfill incremental to avoid blocking UI.

### Testing

- Unit tests for aggregation and cost computation.
- Update or add tests for ingestion sources as needed.
- Run `yarn lint`, `yarn test`, and `yarn format` before completion.
