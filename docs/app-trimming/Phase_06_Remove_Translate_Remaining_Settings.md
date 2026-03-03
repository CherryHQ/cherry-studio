# Phase 06: Remove Standalone Translate & Remaining Settings Features

## Overall Product Objective

Transform the full-featured Cherry Studio Electron app (~1545 source files, ~346 npm dependencies) into a lightweight Quick Selection Assistant utility — a fast, focused tool for AI-powered text actions (summarize, translate, explain, refine, custom prompts) — targeting ~150-200 source files and ~100-130 npm dependencies.

## Phase Goal

Remove the standalone Translate page, Quick Phrase settings, Quick Assistant settings, Agent Settings, the Copilot feature, and the **Mini Window / Quick Assistant floating UI** (the separate floating windows for chat, translate, and clipboard that are distinct from our Selection Assistant). This is the final "feature removal" phase before tackling the Home/Chat page.

**Important distinction**: The selection assistant's translate **action** (inside the floating action window, powered by `ActionTranslate.tsx`) is completely unaffected. Only the standalone `/translate` page route is removed. The `TranslateSettingsPopup` (used by the selection translate action) also stays.

## Scope

- **Standalone Translate page** (`/translate`)
- **Quick Phrase Settings** (`/settings/quickphrase`)
- **Quick Assistant Settings** (`/settings/quickAssistant`) — distinct from the Selection Assistant
- **Agent Settings** directory (popup, not routed — but used by removed features)
- **Mini Window / Quick Assistant floating UI** — Separate Electron windows (`src/renderer/src/windows/mini/`, `src/main/windows/mini/`) with ChatWindow, HomeWindow, TranslateWindow, ClipboardPreview. Triggered via tray click and global shortcut.
- **Store slices**: `translate`, `copilot`, `inputTools`, `shortcuts` (if only used by removed features)
- **Store fields to clean**: `settings.enableQuickAssistant`, `settings.clickTrayToShowQuickAssistant`, `settings.readClipboardAtStartup`, `settings.windowStyle`, `llm.quickAssistantId`
- **Renderer services**: `PluginService.ts`
- **Preload namespaces**: `api.copilot.*`, `api.miniWindow.*`

## Out of Scope

- Selection assistant's `ActionTranslate.tsx` (stays — it's the floating action window's translate feature)
- `TranslateSettingsPopup/` (stays — used by selection translate action)
- Home/Chat page (Phase 07)
- Package.json dependency cleanup (Phase 10)

## Dependencies

### Previous Phases
- None — this phase is independently executable.

### External Systems
- None.

## Deliverables

1. Standalone Translate page directory deleted
2. Two settings page files deleted (QuickPhraseSettings, QuickAssistantSettings)
3. Agent Settings directory deleted
4. Mini Window renderer and main process directories deleted
5. Up to four Redux store slices removed (`translate`, `copilot`, `inputTools`, `shortcuts`)
6. Quick Assistant related store fields cleaned from `settings` and `llm` slices
7. One renderer service deleted (`PluginService.ts`)
8. Two preload namespaces removed (`api.copilot.*`, `api.miniWindow.*`)
9. WindowService mini window methods removed (`createMiniWindow`, `showMiniWindow`, `hideMiniWindow`, `closeMiniWindow`, `toggleMiniWindow`, `setPinMiniWindow`)
10. ShortcutService mini window toggle shortcut removed
11. TrayService mini window trigger removed
12. Router cleaned of `/translate` route
13. Sidebar cleaned of `'translate'` icon
14. Settings page cleaned of Quick Phrase and Quick Assistant routes and menu items
15. App compiles and runs with `pnpm build:check`

## Technical Tasks

### 1. Edit `src/renderer/src/Router.tsx`
Remove import:
- `import TranslatePage from './pages/translate/TranslatePage'`

Remove route:
- `<Route path="/translate" element={<TranslatePage />} />`

### 2. Edit `src/renderer/src/config/sidebar.ts`
Remove from `DEFAULT_SIDEBAR_ICONS`: `'translate'`

### 3. Edit `src/renderer/src/store/index.ts`
Remove imports and `combineReducers` entries:
- `import translate from './translate'`
- `import copilot from './copilot'`
- `import inputToolsReducer from './inputTools'`

For `shortcuts`: check if any remaining feature (selection assistant, settings) imports from the shortcuts slice. If not, also remove:
- `import shortcuts from './shortcuts'`

### 4. Edit `src/renderer/src/pages/settings/SettingsPage.tsx`
Remove imports:
- `import QuickPhraseSettings from './QuickPhraseSettings'`
- `import QuickAssistantSettings from './QuickAssistantSettings'`

Remove menu items (the `<MenuItemLink>` blocks):
- `/settings/quickphrase` (Zap icon)
- `/settings/quickAssistant` (PictureInPicture2 icon)

Remove routes:
- `<Route path="quickphrase" element={<QuickPhraseSettings />} />`
- `<Route path="quickAssistant" element={<QuickAssistantSettings />} />`

Remove orphaned `<Divider />` components surrounding the removed items (the one before Quick Assistant and the one after it).

### 5. Edit `src/preload/index.ts`
Remove API namespaces:
- `api.copilot.*`
- `api.miniWindow.*` (`show`, `hide`, `close`, `toggle`, `setPin`)

### 6. Remove Mini Window from WindowService / ShortcutService / TrayService
- **`WindowService.ts`**: Remove `createMiniWindow()`, `showMiniWindow()`, `hideMiniWindow()`, `closeMiniWindow()`, `toggleMiniWindow()`, `setPinMiniWindow()` methods. Remove mini window BrowserWindow creation and management.
- **`ShortcutService.ts`**: Remove the global shortcut registration that triggers `toggleMiniWindow`.
- **`TrayService.ts`**: Remove tray click handler that shows the mini window (keep tray for other purposes).

### 7. Clean Quick Assistant store fields
- In `src/renderer/src/store/settings.ts`: Remove `enableQuickAssistant`, `clickTrayToShowQuickAssistant`, `readClipboardAtStartup`, `windowStyle` state fields, actions, and selectors.
- In `src/renderer/src/store/llm.ts`: Remove `quickAssistantId` field, its action, and selector.

### 8. Delete files and directories
```
rm -rf src/renderer/src/pages/translate/
rm -rf src/renderer/src/windows/mini/
rm -rf src/main/windows/mini/
rm -f  src/renderer/src/pages/settings/QuickPhraseSettings.tsx
rm -f  src/renderer/src/pages/settings/QuickAssistantSettings.tsx
rm -rf src/renderer/src/pages/settings/AgentSettings/
rm -f  src/renderer/src/store/translate.ts
rm -f  src/renderer/src/store/copilot.ts
rm -f  src/renderer/src/store/inputTools.ts
rm -f  src/renderer/src/services/PluginService.ts
```

### 9. Verify
```bash
pnpm format && pnpm build:check
```

## Acceptance Criteria

- [ ] `pnpm build:check` passes
- [ ] App launches without errors
- [ ] `/translate` URL shows blank/404 — no crash
- [ ] Settings page no longer shows Quick Phrase or Quick Assistant menu items
- [ ] Sidebar no longer shows Translate icon
- [ ] Selection assistant's translate **action** still works (ActionTranslate.tsx is unaffected)
- [ ] `TranslateSettingsPopup/` directory still exists and is functional
- [ ] Mini Window no longer launches (no floating chat/translate/clipboard windows)
- [ ] Tray icon still works but no longer triggers mini window
- [ ] Global shortcut for mini window no longer registered
- [ ] Selection Assistant still functions correctly for all actions

## Clarifications Needed

- **`shortcuts` slice usage**: The PRD marks this as "DELETE if only used by removed features." An audit is needed to verify whether any remaining code (selection assistant settings, shortcut registration) reads from this slice before removing it. If in doubt, keep it — it can be cleaned up in Phase 09.

## Summary of Previous Phases

- **Phase 01**: Removed Paintings, Code Tools, OpenClaw, Mini Apps, Launchpad pages.
- **Phase 02**: Removed Knowledge Bases, File Manager, Doc Processing Settings.
- **Phase 03**: Removed Notes, Memory features with persistor callback cleanup.
- **Phase 04**: Removed MCP, Web Search, API Server Settings.
- **Phase 05**: Removed Sync/Backup/Proxy, Data Settings, Agent Store/Presets.

## Next Phase Preview

**Phase 07: Extract MessageContent & Remove Home/Chat Page** is the highest-risk phase in the entire trimming process. The `MessageContent` component is deeply nested inside `pages/home/Messages/` but is imported by the selection action windows. It must be extracted to a shared `components/Markdown/` location *before* the home page directory can be deleted. This phase also redirects the default route from `/` (Home) to `/selection`.
