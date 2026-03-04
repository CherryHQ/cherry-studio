# Quickstart: Remove MCP & Web Search Features

**Branch**: `004-remove-mcp-websearch` | **Date**: 2026-03-04

## Purpose

Step-by-step guide for a developer implementing Phase 04. All steps must be completed in order. The goal is to leave the repo with a green `pnpm build:check` and a functioning Selection Assistant.

---

## Prerequisites

- On branch `004-remove-mcp-websearch` (created by `/2.specify`)
- `pnpm install` already run
- App runs in dev mode via `pnpm dev`

---

## Step-by-Step Implementation

### Step 1 — Delete settings directory trees

```bash
rm -rf src/renderer/src/pages/settings/MCPSettings/
rm -rf src/renderer/src/pages/settings/WebSearchSettings/
rm -rf src/renderer/src/pages/settings/ToolSettings/
```

### Step 2 — Delete Redux store slices

```bash
rm -f src/renderer/src/store/mcp.ts
rm -f src/renderer/src/store/websearch.ts
rm -f src/renderer/src/store/toolPermissions.ts
```

### Step 3 — Delete renderer services and AI tools

```bash
rm -f src/renderer/src/services/MCPClientService.ts
rm -f src/renderer/src/services/WebSearchService.ts
rm -f src/renderer/src/aiCore/tools/WebSearchTool.ts
rm -f src/renderer/src/providers/WebSearchProvider/LocalSearchProvider.ts
```

### Step 4 — Delete main process services

```bash
rm -f src/main/services/MCPService.ts
rm -f src/main/services/SearchService.ts
```

### Step 5 — Delete exclusively-wrapping hooks

```bash
rm -f src/renderer/src/hooks/useMCPServers.ts
rm -f src/renderer/src/hooks/useWebSearchProviders.ts
```

### Step 6 — Edit `src/renderer/src/store/index.ts`

Remove these lines:
- `import mcp from './mcp'`
- `import websearch from './websearch'`
- `import toolPermissions from './toolPermissions'`
- `websearch,` from `combineReducers({...})`
- `mcp,` from `combineReducers({...})`
- `toolPermissions` from `combineReducers({...})`
- `'toolPermissions'` from the `blacklist` array

### Step 7 — Edit `src/renderer/src/pages/settings/SettingsPage.tsx`

Remove:
- `import { McpLogo } from '@renderer/components/Icons'`
- `import MCPSettings from './MCPSettings'`
- `import WebSearchSettings from './WebSearchSettings'`
- `import { ApiServerSettings } from './ToolSettings/ApiServerSettings'`
- `Search,` and `Server,` from the lucide-react import
- The `<MenuItemLink to="/settings/mcp">...</MenuItemLink>` block
- The `<MenuItemLink to="/settings/websearch">...</MenuItemLink>` block
- The `<MenuItemLink to="/settings/api-server">...</MenuItemLink>` block
- The `<Divider />` immediately above the MCP menu item (between Data Settings and MCP)
- `<Route path="websearch/*" element={<WebSearchSettings />} />`
- `<Route path="api-server" element={<ApiServerSettings />} />`
- `<Route path="mcp/*" element={<MCPSettings />} />`

### Step 8 — Edit `src/main/index.ts`

Remove:
- `import mcpService from './services/MCPService'`
- `await mcpService.cleanup()` (in the app quit/cleanup handler)
- The `apiServerService` initialization block (start logic) and its cleanup call
- `import { apiServerService } from './services/ApiServerService'` if it becomes unused

### Step 9 — Edit `src/preload/index.ts`

Remove the following namespace blocks from the `api` object:
- `mcp: { ... }` block (all MCP IPC calls)
- `searchService: { ... }` block (all search service IPC calls)
- `agentTools: { ... }` block (all agent tools IPC calls)
- `apiServer: { ... }` block (all API server IPC calls)

Also remove any TypeScript type imports that were exclusively needed by these blocks.

### Step 10 — Remove i18n keys

From all three locale files (`en-us.json`, `zh-cn.json`, `zh-tw.json`), remove:
- The entire `settings.mcp` subtree under `settings`
- The `websearch` key under `settings.tool` (or the full `settings.tool.websearch` subtree)
- The entire `apiServer` top-level key

Then run:
```bash
pnpm i18n:sync
```

### Step 11 — First build check (enumerate TypeScript errors)

```bash
pnpm lint
```

Review the output. For each TypeScript error referencing a deleted module, note the file and fix it:

**Known files to clean up (see frontend-spec.md for details)**:
- `src/renderer/src/hooks/useAppInit.ts` — remove `toolPermissions` import
- `src/renderer/src/aiCore/prepareParams/parameterBuilder.ts` — remove websearch imports
- `src/renderer/src/aiCore/utils/websearch.ts` — remove or delete
- `src/renderer/src/aiCore/utils/options.ts` — remove websearch utility usage
- `src/renderer/src/pages/home/**` — remove toolPermissions/mcp imports from Chat components
- `src/renderer/src/aiCore/utils/__tests__/mcp.test.ts` — DELETE
- `src/renderer/src/aiCore/utils/__tests__/websearch.test.ts` — DELETE

Re-run `pnpm lint` after each batch of fixes until 0 errors remain.

### Step 12 — Format and final build gate

```bash
pnpm format
pnpm build:check
```

Both must exit with code 0.

### Step 13 — Manual smoke test

1. Run `pnpm dev`
2. Open Settings — confirm no MCP, Web Search, API Server menu items
3. Test all five Selection Assistant actions (summarize, translate, explain, refine, browser-search)
4. Check DevTools console for errors

---

## Key Files Reference

| File | Change |
|------|--------|
| `src/renderer/src/store/index.ts` | Remove 3 imports, 3 combineReducers entries, 1 blacklist entry |
| `src/renderer/src/pages/settings/SettingsPage.tsx` | Remove 4 imports, 3 menu items, 1 divider, 3 routes |
| `src/main/index.ts` | Remove MCPService + ApiServerService init/cleanup |
| `src/preload/index.ts` | Remove 4 API namespace blocks |
| `*/locales/*.json` (×3) | Remove settings.mcp, settings.tool.websearch, apiServer keys |

---

## If Build:Check Fails

- **TypeScript errors on deleted imports**: Follow Step 11 — fix each cross-reference
- **i18n sort errors**: Run `pnpm i18n:sync` then retry
- **Biome formatting errors**: Run `pnpm format` then retry
- **Test failures**: Check if affected test files test deleted utilities — delete those test files
