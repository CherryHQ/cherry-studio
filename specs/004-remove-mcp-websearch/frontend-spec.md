# Frontend Specification: Remove MCP & Web Search Features

**Branch**: `004-remove-mcp-websearch` | **Date**: 2026-03-04

## Overview

This document specifies all required changes to the renderer-side UI layer. All changes are **removals** — no new screens or components are introduced.

---

## Screen: Settings Page

**File**: `src/renderer/src/pages/settings/SettingsPage.tsx`

### Current State (Before)

The settings sidebar navigation contains (in order):

1. Provider Settings
2. Model Settings
3. `<Divider />`
4. General Settings
5. Display Settings
6. Data Settings
7. `<Divider />`
8. **MCP Settings** ← REMOVE
9. **Web Search Settings** ← REMOVE
10. **API Server Settings** ← REMOVE
11. Quick Phrase Settings
12. Shortcut Settings
13. `<Divider />`
14. Quick Assistant Settings
15. `<Divider />`
16. About Settings

### Target State (After)

1. Provider Settings
2. Model Settings
3. `<Divider />`
4. General Settings
5. Display Settings
6. Data Settings
7. `<Divider />`
8. Quick Phrase Settings  ← now immediately follows the divider
9. Shortcut Settings
10. `<Divider />`
11. Quick Assistant Settings
12. `<Divider />`
13. About Settings

### Changes Required

#### Imports to Remove
```
import { McpLogo } from '@renderer/components/Icons'
import MCPSettings from './MCPSettings'
import WebSearchSettings from './WebSearchSettings'
import { ApiServerSettings } from './ToolSettings/ApiServerSettings'
```

#### Icon imports to remove from lucide-react destructure
```
Search,   // used only for WebSearch menu item
Server,   // used only for API Server menu item
```
(Keep: `Cloud`, `Command`, `HardDrive`, `Info`, `MonitorCog`, `Package`, `PictureInPicture2`, `Settings2`, `Zap`)

#### Menu Items to Remove (JSX blocks)
```jsx
<MenuItemLink to="/settings/mcp">
  <MenuItem className={isRoute('/settings/mcp')}>
    <McpLogo width={18} height={18} style={{ opacity: 0.8 }} />
    {t('settings.mcp.title')}
  </MenuItem>
</MenuItemLink>
<MenuItemLink to="/settings/websearch">
  <MenuItem className={isRoute('/settings/websearch')}>
    <Search size={18} />
    {t('settings.tool.websearch.title')}
  </MenuItem>
</MenuItemLink>
<MenuItemLink to="/settings/api-server">
  <MenuItem className={isRoute('/settings/api-server')}>
    <Server size={18} />
    {t('apiServer.title')}
  </MenuItem>
</MenuItemLink>
```

#### Divider to Remove
The `<Divider />` immediately **above** the MCP menu item (currently between Data Settings and MCP Settings). After removal, only the divider below Quick Phrase (now separating Data from Quick Phrase) should remain.

#### Routes to Remove (inside `<Routes>`)
```jsx
<Route path="websearch/*" element={<WebSearchSettings />} />
<Route path="api-server" element={<ApiServerSettings />} />
<Route path="mcp/*" element={<MCPSettings />} />
```

---

## Directories to Delete

These complete directory trees are deleted with no partial retention:

| Path | Contents |
|------|---------|
| `src/renderer/src/pages/settings/MCPSettings/` | MCP server management UI, marketplace, provider config |
| `src/renderer/src/pages/settings/WebSearchSettings/` | Web search provider configuration UI (Tavily, Exa, etc.) |
| `src/renderer/src/pages/settings/ToolSettings/` | Contains `ApiServerSettings.tsx` and related tool settings |

---

## i18n Key Removal

**Files affected**: All three locale files:
- `src/renderer/src/i18n/locales/en-us.json`
- `src/renderer/src/i18n/locales/zh-cn.json`
- `src/renderer/src/i18n/locales/zh-tw.json`

**Key groups to remove**:

| Key Path | Reason |
|----------|--------|
| `settings.mcp` (entire subtree) | All MCP settings labels and messages |
| `settings.tool.websearch` (entire subtree) | All Web Search settings labels |
| `apiServer` (entire top-level key) | All API Server settings labels |

**Post-removal step**: Run `pnpm i18n:sync` to re-synchronize the i18n template file and resolve any key ordering/sorting issues before running `pnpm build:check`.

---

## Hooks to Delete

These hooks exclusively wrap the deleted store slices:

| File | Reason |
|------|--------|
| `src/renderer/src/hooks/useMCPServers.ts` | Only imports from and dispatches to `store/mcp` |
| `src/renderer/src/hooks/useWebSearchProviders.ts` | Only imports from and dispatches to `store/websearch` |

---

## Cross-Reference Cleanup (TypeScript Error Resolution)

After primary deletions, run `pnpm build:check` to enumerate remaining TypeScript errors. For each error referencing a deleted module:

### Known files requiring targeted cleanup:

| File | Action |
|------|--------|
| `src/renderer/src/hooks/useAppInit.ts` | Remove import of `toolPermissions` actions; remove associated initialization calls |
| `src/renderer/src/aiCore/prepareParams/parameterBuilder.ts` | Remove import of `CherryWebSearchConfig` from `store/websearch`; remove web search parameter setup |
| `src/renderer/src/aiCore/utils/websearch.ts` | Remove or stub (this file wraps the deleted websearch store) |
| `src/renderer/src/aiCore/utils/options.ts` | Remove `getWebSearchParams` import if source file deleted |
| `src/renderer/src/pages/home/**` | Remove imports of `toolPermissions`, `mcp-tools` utilities where the file's primary purpose is Chat (acceptable degradation per Q1) |

**Rule for Chat-page cleanup**: If deleting the import would leave a no-op file with no remaining purpose, delete the file. If the file has other content unrelated to MCP/WebSearch/toolPermissions, remove only the specific import and its usages.

---

## Selection Assistant: No Changes

The Selection Assistant settings and functionality are **not touched**. Confirmed paths:
- `src/renderer/src/pages/settings/SelectionAssistantSettings/` — untouched
- `src/renderer/src/pages/settings/QuickAssistantSettings.tsx` — untouched
- The browser-URL-open search action in the selection assistant has no dependency on the deleted web search providers.
