# Data Model: Remove MCP & Web Search Features

**Branch**: `004-remove-mcp-websearch` | **Date**: 2026-03-04

## Overview

This document describes the Redux state entities being **removed** from the application's state management layer. The purpose is to capture their current shape so implementers can safely identify all usages and confirm nothing is accidentally left behind.

No new entities are introduced in this phase.

---

## Deleted State Slices

### 1. `mcp` Slice (`store/mcp.ts`)

**What it represents**: The list of configured MCP (Model Context Protocol) servers. Used by the Chat page to call external tools via the MCP protocol.

**State shape (conceptual)**:
```
mcp: {
  servers: MCPServer[]    // Each server has: id, name, type, command, args, env, url, etc.
}
```

**Removed from**:
- `combineReducers` in `store/index.ts`
- Import in `store/index.ts`
- Consumed by: `hooks/useMCPServers.ts`, `MCPSettings/` components, `aiCore/` pipeline

---

### 2. `websearch` Slice (`store/websearch.ts`)

**What it represents**: Configuration for AI-powered web search providers (Tavily, Exa, etc.) and search behaviour settings used in the Chat page.

**State shape (conceptual)**:
```
websearch: {
  providers: WebSearchProvider[]   // Each provider: id, name, apiKey, enabled, etc.
  defaultProvider: string
  searchMode: 'auto' | 'manual'
  // ...additional search settings
}
```

**Removed from**:
- `combineReducers` in `store/index.ts`
- Import in `store/index.ts`
- Consumed by: `hooks/useWebSearchProviders.ts`, `WebSearchSettings/` components, `aiCore/prepareParams/`, `aiCore/utils/websearch.ts`

---

### 3. `toolPermissions` Slice (`store/toolPermissions.ts`)

**What it represents**: Runtime permission state for AI tool calls in the Chat page — tracks pending approval requests and granted/denied permissions for MCP tool invocations.

**State shape (conceptual)**:
```
toolPermissions: {
  pendingPermission: PermissionEntry | null
  // ...permission tracking state
}
```

**Removed from**:
- `combineReducers` in `store/index.ts`
- Import in `store/index.ts`
- `blacklist` array in `persistReducer` config (currently excluded from persistence)
- Consumed by: `hooks/useAppInit.ts`, `pages/home/Messages/Tools/` components

---

## Persisted State Impact

The `persistReducer` config currently blacklists `'toolPermissions'`:

```
blacklist: ['runtime', 'messages', 'messageBlocks', 'tabs', 'toolPermissions']
```

After this phase, `'toolPermissions'` is removed from the blacklist (no longer needed since the slice is deleted). The remaining blacklist:

```
blacklist: ['runtime', 'messages', 'messageBlocks', 'tabs']
```

**Migration**: No migration step required. Any previously persisted state that contains a `toolPermissions` key will be silently ignored by `redux-persist` since the key no longer maps to a registered reducer.

---

## IPC Namespaces Removed from Preload

The following namespaces are removed from the `api` object exposed via `contextBridge`:

| Namespace | Purpose |
|-----------|---------|
| `api.mcp.*` | Frontend calls to MCPService for server management, tool listing, tool invocation |
| `api.searchService.*` | Frontend calls to SearchService (hidden BrowserWindow web scraper) |
| `api.agentTools.*` | Frontend calls to agent tool management (tied to MCP/tool infrastructure) |
| `api.apiServer.*` | Frontend calls to ApiServerService for start/stop/status of the local REST API server |

---

## Main Process Services Removed

| Service File | Purpose |
|-------------|---------|
| `src/main/services/MCPService.ts` | Manages MCP server processes (stdio, SSE, streamable HTTP). Initialises and cleans up MCP server connections. |
| `src/main/services/SearchService.ts` | Hidden Electron BrowserWindow used to scrape web search results. Started as a background process. |

Note: `ApiServerService.ts` (local REST API server for agent integration) is **not deleted** in this phase — only its settings UI and IPC preload namespace are removed. The service itself stays to avoid breaking agent-related infrastructure before Phase 07.

---

## Renderer Services Removed

| Service File | Purpose |
|-------------|---------|
| `src/renderer/src/services/MCPClientService.ts` | Renderer-side client that calls `api.mcp.*` to communicate with MCPService |
| `src/renderer/src/services/WebSearchService.ts` | Renderer-side service that calls `api.searchService.*` to perform AI-powered web searches |

## AI Tool Files Removed

| File | Purpose |
|------|---------|
| `src/renderer/src/aiCore/tools/WebSearchTool.ts` | AI SDK tool definition for web search, used in the Chat AI pipeline |
| `src/renderer/src/providers/WebSearchProvider/LocalSearchProvider.ts` | Search provider implementation used by the Chat AI pipeline |
