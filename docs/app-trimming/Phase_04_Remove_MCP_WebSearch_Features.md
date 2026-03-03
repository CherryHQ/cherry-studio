# Phase 04: Remove MCP & Web Search Features

## Overall Product Objective

Transform the full-featured Cherry Studio Electron app (~1545 source files, ~346 npm dependencies) into a lightweight Quick Selection Assistant utility — a fast, focused tool for AI-powered text actions (summarize, translate, explain, refine, custom prompts) — targeting ~150-200 source files and ~100-130 npm dependencies.

## Phase Goal

Remove the MCP (Model Context Protocol) server management system, the AI-powered Web Search integration, and the API Server settings. The selection assistant's "search" action is a simple browser URL open (`google.com/search?q=...`) — it is completely independent from the WebSearchSettings which configures AI search providers like Tavily and Exa.

## Scope

- **MCP Settings** (`/settings/mcp`) — MCP server management, marketplace, providers
- **Web Search Settings** (`/settings/websearch`) — AI-powered search provider configuration (Tavily, Exa, etc.)
- **API Server Settings** (`/settings/api-server`) — Local API server for external tool integration
- **Backend services**: `MCPService`, `SearchService` (hidden BrowserWindow-based web scraper)
- **Renderer services**: `MCPClientService.ts`, `WebSearchService.ts`
- **Renderer AI tools**: `WebSearchTool.ts`, `LocalSearchProvider.ts`
- **Store slices**: `mcp`, `websearch`, `toolPermissions`
- **Preload namespaces**: `api.mcp.*`, `api.searchService.*`, `api.agentTools.*`, `api.apiServer.*`
- **`persistReducer` blacklist**: Remove `'toolPermissions'` entry

## Out of Scope

- Selection assistant's simple browser-search action (this stays — it's just a URL open)
- Sync/Backup/Proxy features (Phase 05)
- Home/Chat page (Phase 07)
- `@modelcontextprotocol/*` package removal from package.json (Phase 10)

## Dependencies

### Previous Phases
- None — this phase is independently executable.

### External Systems
- None.

## Deliverables

1. Three settings sub-route directories/components deleted (MCPSettings, WebSearchSettings, ToolSettings)
2. Three Redux store slices removed (`mcp`, `websearch`, `toolPermissions`)
3. `persistReducer` blacklist updated (removed `'toolPermissions'`)
4. Two main process services deleted (`MCPService`, `SearchService`)
5. Two renderer services deleted
6. Renderer AI tools deleted (`WebSearchTool.ts`, `LocalSearchProvider.ts`)
7. Four preload namespaces removed
8. Three settings menu items and routes removed from SettingsPage
9. App compiles and runs with `pnpm build:check`

## Technical Tasks

### 1. Edit `src/renderer/src/store/index.ts`
Remove imports and `combineReducers` entries:
- `import mcp from './mcp'`
- `import websearch from './websearch'`
- `import toolPermissions from './toolPermissions'`

Remove `'toolPermissions'` from the `blacklist` array in the `persistReducer` config.

### 2. Edit `src/renderer/src/pages/settings/SettingsPage.tsx`
Remove imports:
- `import MCPSettings from './MCPSettings'`
- `import WebSearchSettings from './WebSearchSettings'`
- `import { ApiServerSettings } from './ToolSettings/ApiServerSettings'`
- `import { McpLogo } from '@renderer/components/Icons'` (if only used here)

Remove menu items (the `<MenuItemLink>` blocks):
- `/settings/mcp` (McpLogo icon)
- `/settings/websearch` (Search icon)
- `/settings/api-server` (Server icon)

Remove routes:
- `<Route path="mcp/*" element={<MCPSettings />} />`
- `<Route path="websearch/*" element={<WebSearchSettings />} />`
- `<Route path="api-server" element={<ApiServerSettings />} />`

Remove any orphaned `<Divider />` components between the removed menu items.

### 3. Edit `src/main/index.ts`
Remove initialization and cleanup calls for:
- `MCPService`
- `SearchService` (creates hidden BrowserWindow instances for web scraping)

### 4. Edit `src/preload/index.ts`
Remove API namespaces:
- `api.mcp.*`
- `api.searchService.*`
- `api.agentTools.*`
- `api.apiServer.*`

### 5. Delete files and directories
```
rm -rf src/renderer/src/pages/settings/MCPSettings/
rm -rf src/renderer/src/pages/settings/WebSearchSettings/
rm -rf src/renderer/src/pages/settings/ToolSettings/
rm -f  src/renderer/src/store/mcp.ts
rm -f  src/renderer/src/store/websearch.ts
rm -f  src/renderer/src/store/toolPermissions.ts
rm -f  src/renderer/src/services/MCPClientService.ts
rm -f  src/renderer/src/services/WebSearchService.ts
rm -f  src/main/services/MCPService.ts
rm -f  src/main/services/SearchService.ts
rm -f  src/renderer/src/aiCore/tools/WebSearchTool.ts
rm -f  src/renderer/src/providers/WebSearchProvider/LocalSearchProvider.ts
```

### 6. Verify
```bash
pnpm format && pnpm build:check
```

## Acceptance Criteria

- [ ] `pnpm build:check` passes
- [ ] App launches without errors
- [ ] Settings page no longer shows MCP, Web Search, or API Server menu items
- [ ] No TypeScript errors referencing deleted MCP/WebSearch/ToolSettings modules
- [ ] Selection assistant's "search" action still works (browser URL open is unaffected)
- [ ] Selection Assistant still functions correctly for all other actions

## Summary of Previous Phases

- **Phase 01**: Removed Paintings, Code Tools, OpenClaw, Mini Apps, Launchpad pages.
- **Phase 02**: Removed Knowledge Bases, File Manager, Doc Processing Settings.
- **Phase 03**: Removed Notes, Memory features with safe persistor callback cleanup.

## Next Phase Preview

**Phase 05: Remove Sync, Backup & Proxy Features** will remove the data synchronization systems (Nutstore, WebDAV), backup/restore functionality, proxy service, Data Settings sub-route, and the Agent Store/Presets page. These are infrastructure features the selection assistant does not need.
