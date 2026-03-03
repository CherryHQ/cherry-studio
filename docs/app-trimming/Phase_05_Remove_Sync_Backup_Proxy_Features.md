# Phase 05: Remove Sync, Backup & Proxy Features

## Overall Product Objective

Transform the full-featured Cherry Studio Electron app (~1545 source files, ~346 npm dependencies) into a lightweight Quick Selection Assistant utility — a fast, focused tool for AI-powered text actions (summarize, translate, explain, refine, custom prompts) — targeting ~150-200 source files and ~100-130 npm dependencies.

## Phase Goal

Remove all data synchronization, backup/restore, proxy, and cloud integration features. This includes the Data Settings sub-route, the Agent Store/Presets page, and five main process backend services. The selection assistant stores its configuration locally and does not need any of these infrastructure features.

## Scope

- **Agent Store/Presets page** (`/store`) — Assistant preset marketplace
- **Data Settings** (`/settings/data`) — Backup/restore, cloud sync (Joplin, Notion, Obsidian, SiYuan, Yuque, Nutstore, WebDAV, S3), data directory migration
- **LAN Transfer** — Local network peer-to-peer transfer (mDNS discovery, TCP binary protocol)
- **Backend services**: `BackupService`, `NutstoreService`, `WebDavService`, `ProxyService`, `ExportService`, `LocalTransferService`, `lanTransfer/LanTransferClientService`
- **Renderer services**: `NutstoreService.ts`
- **Renderer components**: `LanTransferPopup/` (popup UI for LAN transfers)
- **Store slices**: `backup`, `nutstore`
- **Preload namespaces**: `api.backup.*`, `api.export.*`, `api.nutstore.*`, `api.proxy.*`, `api.localTransfer.*`

## Out of Scope

- Standalone Translate page (Phase 06)
- Quick Phrase, Quick Assistant, Agent Settings (Phase 06)
- Home/Chat page (Phase 07)
- `https-proxy-agent`, `webdav` package removal from package.json (Phase 10)

## Dependencies

### Previous Phases
- None — this phase is independently executable.

### External Systems
- None.

## Deliverables

1. Agent Store/Presets page directory deleted
2. Data Settings directory deleted
3. Two Redux store slices removed (`backup`, `nutstore`)
4. Seven main process services deleted (including LAN Transfer subsystem)
5. One renderer service deleted, one renderer popup component deleted
6. Five preload namespaces removed
7. Router cleaned of `/store` route
8. Sidebar cleaned of `'store'` icon
9. Settings page cleaned of Data Settings route and menu item
10. App compiles and runs with `pnpm build:check`

## Technical Tasks

### 1. Edit `src/renderer/src/Router.tsx`
Remove import:
- `import AssistantPresetsPage from './pages/store/assistants/presets/AssistantPresetsPage'`

Remove route:
- `<Route path="/store" element={<AssistantPresetsPage />} />`

### 2. Edit `src/renderer/src/config/sidebar.ts`
Remove from `DEFAULT_SIDEBAR_ICONS`: `'store'`

### 3. Edit `src/renderer/src/store/index.ts`
Remove imports and `combineReducers` entries:
- `import backup from './backup'`
- `import nutstore from './nutstore'`

### 4. Edit `src/renderer/src/pages/settings/SettingsPage.tsx`
- Remove import: `import DataSettings from './DataSettings/DataSettings'`
- Remove menu item block for `/settings/data` (the `<MenuItemLink>` wrapping the HardDrive icon)
- Remove route: `<Route path="data" element={<DataSettings />} />`

### 5. Edit `src/main/index.ts`
Remove initialization and cleanup calls for:
- `BackupService`
- `NutstoreService`
- `WebDavService`
- `ProxyService`
- `ExportService`

### 6. Edit `src/preload/index.ts`
Remove API namespaces:
- `api.backup.*`
- `api.export.*`
- `api.nutstore.*`
- `api.proxy.*`
- `api.localTransfer.*` (`getState`, `startScan`, `stopScan`, `connect`, `disconnect`, `onServicesUpdated`, `onClientEvent`, `sendFile`, `cancelTransfer`)

### 7. Delete files and directories
```
rm -rf src/renderer/src/pages/store/
rm -rf src/renderer/src/pages/settings/DataSettings/
rm -rf src/renderer/src/components/Popups/LanTransferPopup/
rm -f  src/renderer/src/store/backup.ts
rm -f  src/renderer/src/store/nutstore.ts
rm -f  src/renderer/src/services/NutstoreService.ts
rm -f  src/main/services/BackupService.ts
rm -f  src/main/services/NutstoreService.ts
rm -f  src/main/services/WebDavService.ts
rm -f  src/main/services/ProxyService.ts
rm -f  src/main/services/ExportService.ts
rm -f  src/main/services/LocalTransferService.ts
rm -rf src/main/services/lanTransfer/
```

### 8. Verify
```bash
pnpm format && pnpm build:check
```

## Acceptance Criteria

- [ ] `pnpm build:check` passes
- [ ] App launches without errors
- [ ] `/store` URL shows blank/404 — no crash
- [ ] Settings page no longer shows "Data" menu item
- [ ] Sidebar no longer shows Store/Presets icon
- [ ] No TypeScript errors referencing deleted backup/nutstore/proxy/lanTransfer modules
- [ ] Selection Assistant still functions correctly

## Clarifications Needed

- **`api.proxy.*` namespace ownership**: The PRD lists this namespace in both Phase 05 and mentions it as "if not already in another phase." Verify that no other phase claims this namespace. If it was already removed in a prior execution, skip it here.

## Summary of Previous Phases

- **Phase 01**: Removed Paintings, Code Tools, OpenClaw, Mini Apps, Launchpad pages.
- **Phase 02**: Removed Knowledge Bases, File Manager, Doc Processing Settings.
- **Phase 03**: Removed Notes, Memory features with persistor callback cleanup.
- **Phase 04**: Removed MCP, Web Search, API Server Settings.

## Next Phase Preview

**Phase 06: Remove Standalone Translate & Remaining Settings Features** will remove the standalone Translate page, Quick Phrase settings, Quick Assistant settings, Agent Settings, and the Copilot feature. The selection assistant's translate **action** (inside the floating action window) is unaffected — only the standalone `/translate` page route is removed.
