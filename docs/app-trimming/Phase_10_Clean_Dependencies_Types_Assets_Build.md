# Phase 10: Clean Dependencies, Types, Assets & Build Config

## Overall Product Objective

Transform the full-featured Cherry Studio Electron app (~1545 source files, ~346 npm dependencies) into a lightweight Quick Selection Assistant utility — a fast, focused tool for AI-powered text actions (summarize, translate, explain, refine, custom prompts) — targeting ~150-200 source files and ~100-130 npm dependencies.

## Phase Goal

Final cleanup phase. Remove ~150+ unused npm dependencies from `package.json`, delete dead TypeScript type definitions, strip orphaned i18n translation keys, remove unused assets/icons, simplify build configurations, delete tests for removed features, and remove unused workspace packages. After this phase, the trimming is complete and the app should meet the target footprint of ~150-200 source files and ~100-130 npm dependencies.

This consolidates PRD Phases 13 and 14 into a single final deliverable.

## Scope

### Package.json Dependency Cleanup
- Remove production dependencies for: heavy markdown (katex, mermaid), MCP/knowledge, file processing, rich text editors, proxy, sync/cloud, code execution, web search, export, screen capture
- Remove devDependencies for removed features
- Verify each removal with `pnpm why <package>` before deleting

### TypeScript Type Definitions
- Remove type definitions for: Agent, Topic (complex types), Knowledge, MCP, Painting, File management, Notes, etc.
- Keep: Provider, Model, Assistant (simplified), Message types, Selection types, Settings types
- Keep entirely: `selectionTypes.ts`, `newMessage.ts`

### i18n Translation Keys
- Remove keys for all deleted features across all locale files
- Keep keys with prefixes: `selection.*`, `settings.*`, `common.*`, `provider.*`, `model.*`

### Assets
- Remove icons/images only used by deleted features
- Keep: app icon, selection-related icons, theme assets

### Build Configuration
- Simplify `electron.vite.config.ts` (remove entry points for deleted windows/pages)
- Simplify `electron-builder.yml` (remove file associations, simplify build targets)
- Preserve Web Worker entries if AI Core uses them

### Test Files
- Remove tests for deleted features
- Keep tests for: AI Core, Selection components, Settings, kept services

### Workspace Packages
- Delete unused workspace packages: `packages/knowledge/`, `packages/mcp/`, `packages/code-runner/`

## Out of Scope

- Functional changes to any remaining feature
- Refactoring of kept code
- New feature development

## Dependencies

### Previous Phases
- **Phases 01-09** (strongly recommended): All feature removal and UI simplification should be complete before cleaning dependencies. Removing a package that's still imported by surviving code will cause build failures.

### External Systems
- None.

## Deliverables

1. `package.json` stripped of ~150+ unused dependencies
2. `pnpm install` succeeds with reduced dependency tree
3. Dead TypeScript types removed from `src/renderer/src/types/`
4. Orphaned i18n keys removed from all locale files
5. Unused assets deleted from `src/renderer/src/assets/`
6. `electron.vite.config.ts` simplified
7. `electron-builder.yml` simplified
8. Tests for deleted features removed
9. Unused workspace packages deleted
10. Full build pipeline passes: `pnpm install && pnpm format && pnpm lint && pnpm build:check`
11. Manual verification: selection assistant works end-to-end

## Technical Tasks

### 1. Clean production dependencies in `package.json`

**Dependencies to KEEP:**

| Category | Packages |
|----------|----------|
| AI SDK | `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, other `@ai-sdk/*` as needed |
| Electron | `electron`, `electron-builder`, `electron-vite`, `@electron-toolkit/*` |
| UI | `react`, `react-dom`, `react-router-dom`, `antd`, `@ant-design/icons`, `styled-components`, `lucide-react`, `react-hotkeys-hook`, `react-i18next`, `i18next` |
| State | `@reduxjs/toolkit`, `react-redux`, `redux-persist` |
| Database | `better-sqlite3`, `drizzle-orm` (if used) |
| Markdown | `react-markdown`, `remark-gfm`, `rehype-raw`, `highlight.js` |
| Utilities | `lodash`, `dayjs`, `uuid`, `nanoid` |
| Native | `node-addon-api` |

**Dependencies to REMOVE:**

| Category | Packages |
|----------|----------|
| Heavy Markdown | `katex`, `react-katex`, `mermaid` |
| MCP/Knowledge | `@modelcontextprotocol/*`, RAG/embedding libs, vector DB libs |
| File Processing | `pdf-parse`, `pdfjs-dist`, `mammoth`, `xlsx`, `papaparse`, `cheerio`, `sharp` |
| Rich Text | `@tiptap/*`, Markdown editor libraries |
| Proxy | `https-proxy-agent` |
| Sync/Cloud | `webdav`, Nutstore SDK/libraries |
| Code Execution | `vm2`, WASM runtimes |
| Web Search | `duckduckgo-search`, web scraping libraries |
| Export | `html-to-image`, `dom-to-image`, PDF generation libraries |
| Screen Capture | `node-screenshots` |

**Process for each dependency:**
```bash
pnpm why <package-name>   # Verify it's truly unused
# If unused → remove from package.json
# If still used → keep it and investigate why
```

### 2. Clean devDependencies
- Remove `@types/*` for removed packages
- Keep: `typescript`, `vite`, `vitest`, `eslint`, `@biomejs/biome`, `@types/*` for kept packages

### 3. Run `pnpm install` to regenerate lockfile
```bash
pnpm install
```

### 4. Clean TypeScript types

Edit `src/renderer/src/types/index.ts`:
- Remove type definitions for: Agent, Topic (complex types), Knowledge, MCP, Painting, CodeRunner, FileManager, Notes, WebSearch, Memory, etc.
- Keep: Provider, Model, Assistant (simplified), Message types, Selection types, Settings types

Verify these files are intact and untouched:
- `src/renderer/src/types/selectionTypes.ts`
- `src/renderer/src/types/newMessage.ts`

### 5. Clean i18n translation keys

For each locale file:
- `src/renderer/src/i18n/locales/en-us.json`
- `src/renderer/src/i18n/locales/zh-cn.json`
- `src/renderer/src/i18n/locales/zh-tw.json`
- `src/renderer/src/i18n/translate/*.json` (de-de, el-gr, es-es, fr-fr, ja-jp, pt-pt, ro-ro, ru-ru)

Remove all keys whose prefixes map to deleted features. Keep keys with prefixes:
- `selection.*`, `settings.*`, `common.*`, `provider.*`, `model.*`
- `message.*` (used by action window), `notification.*` (assistant notification)

### 6. Clean assets

Audit `src/renderer/src/assets/` and delete:
- Icons/images only used by removed features (paintings, code tools, knowledge, etc.)
- Keep: app icon, selection-related icons, theme-related assets

### 7. Simplify build config

**`electron.vite.config.ts`:**
- Remove entry points for deleted windows/pages
- Keep entry points for: main window, selection toolbar window, selection action window
- Verify Web Worker entries are preserved if AI Core uses them

**`electron-builder.yml`:**
- Remove file associations for removed features
- Simplify build targets
- Remove unused native module rebuild configurations

### 8. Remove test files for deleted features

Audit test directories and remove tests for:
- Removed pages, services, store slices, components
- Keep tests for: AI Core, Selection components, Settings, kept services

### 9. Delete unused workspace packages
```bash
rm -rf packages/knowledge/   # if exists
rm -rf packages/mcp/         # if exists
rm -rf packages/code-runner/  # if exists
```

### 10. Full verification
```bash
pnpm install
pnpm format
pnpm lint
pnpm build:check
pnpm dev
```

Manual test: Selection toolbar → trigger action → AI streaming response → copy result. Verify end-to-end flow works correctly.

### 11. Final metrics check
Count remaining source files and npm dependencies to verify targets are met:
```bash
find src/ -name '*.ts' -o -name '*.tsx' | wc -l     # Target: ~150-200
cat package.json | jq '.dependencies | length'        # Target: ~60-80
cat package.json | jq '.devDependencies | length'     # Target: ~40-50
```

## Acceptance Criteria

- [ ] `pnpm install` succeeds with reduced dependency tree
- [ ] `pnpm format && pnpm lint && pnpm build:check` all pass
- [ ] App launches with `pnpm dev`
- [ ] Selection Assistant works end-to-end (toolbar → action → AI streaming → copy)
- [ ] No TypeScript errors referencing deleted types
- [ ] No runtime errors from missing translation keys
- [ ] Source file count is in the ~150-200 range
- [ ] npm dependency count is in the ~100-130 range
- [ ] No unused workspace packages remain
- [ ] Build output size is noticeably smaller than the full app

## Clarifications Needed

- **Exact package list**: The PRD provides categories of packages to remove, not an exhaustive list. The actual `package.json` must be audited line-by-line. `pnpm why <pkg>` is the authoritative check for each dependency.
- **`@ai-sdk/*` scope**: The PRD says "other `@ai-sdk/*` packages as needed per supported providers." The exact list of supported AI providers for the trimmed app needs to be defined. Removing unused provider adapters (e.g., if only OpenAI and Anthropic are needed, Azure/Bedrock adapters could be dropped) would further reduce dependencies.
- **i18n key granularity**: The PRD says "keep keys with these prefixes" but settings-related keys like `settings.mcp.title` should be removed even though they have the `settings.*` prefix. A more precise audit is needed — remove keys that reference deleted features regardless of prefix.
- **Web Worker preservation**: The PRD says "if AI Core uses Web Workers, preserve their Vite entry points." This needs to be verified by inspecting `src/renderer/src/aiCore/` for any `.worker.ts` files or `new Worker()` calls.

## Summary of Previous Phases

- **Phase 01**: Removed Paintings, OVMS, Code Tools, OpenClaw, Mini Apps, Launchpad pages.
- **Phase 02**: Removed Knowledge Bases, File Manager, Doc Processing Settings.
- **Phase 03**: Removed Notes, Memory features with persistor callback cleanup.
- **Phase 04**: Removed MCP, Web Search, SearchService, API Server Settings.
- **Phase 05**: Removed Sync/Backup/Proxy, LAN Transfer, Data Settings, Agent Store/Presets.
- **Phase 06**: Removed Standalone Translate, Quick Phrase/Assistant, Mini Window, Agent Settings, Copilot.
- **Phase 07**: Extracted MessageContent, removed Home/Chat, changed default route.
- **Phase 08**: Cleaned remaining main process services (Analytics, NodeTrace, Python, etc.) and preload API namespaces.
- **Phase 09**: Simplified settings, Provider OAuth, finalized Redux store, simplified sidebar navigation.

## Next Phase Preview

**Phase 11: Remove Agents, Claude Code & DxtService** will remove the entire agent subsystem — the largest remaining backend feature. This includes the agent service directory with its own Drizzle ORM database, session management, Claude Code integration, plugin system, DXT file handling, and API server routes. Most renderer-side agent code is already removed with the Home/Chat page in Phase 07; Phase 11 cleans the main process backend and any remaining renderer artifacts.
