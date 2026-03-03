# Phase 09: Simplify Settings, Redux Store & Navigation

## Overall Product Objective

Transform the full-featured Cherry Studio Electron app (~1545 source files, ~346 npm dependencies) into a lightweight Quick Selection Assistant utility — a fast, focused tool for AI-powered text actions (summarize, translate, explain, refine, custom prompts) — targeting ~150-200 source files and ~100-130 npm dependencies.

## Phase Goal

Polish the remaining UI into a focused, clean experience. This phase simplifies the settings pages that survived the trim (removing sections that configure deleted features), finalizes the Redux store to only contain needed slices, and replaces the full multi-feature sidebar with a minimal two-item navigation (Selection Assistant + Settings).

This consolidates PRD Phases 10, 11, and 12 into a single coherent deliverable.

## Scope

### Settings Page Simplification

**General Settings (`GeneralSettings.tsx`)** — Remove:
- Proxy configuration section (entire `proxyMode` UI, `proxyUrl`, `proxyBypassRules`)
- Notification settings for `backup` and `knowledge` (keep `assistant` notification only)
- Privacy/data collection section

Keep: Language selection, spell check, hardware acceleration, Launch group (start on boot, minimize to tray), Tray group (show tray, close to tray), Developer mode toggle.

**Display Settings (`DisplaySettings/`)** — Remove:
- Sidebar icon manager (`SidebarIconsManager.tsx`)
- Topic display options, navbar position selector, assistant icon type

Keep: Theme selection (light/dark/auto), theme color presets.

**Shortcut Settings (`ShortcutSettings.tsx`)** — Remove:
- Shortcuts for removed features (chat, agents, knowledge, etc.)

Keep: Global selection shortcut configuration.

**About Settings (`AboutSettings.tsx`)** — Remove:
- Auto-update checks (UpdateService removed)
- Update channel selection, sponsor links

Keep: Version display, app info.

**Assistant Settings (`AssistantSettings/`)** — Remove:
- `AssistantMCPSettings.tsx`
- `AssistantKnowledgeBaseSettings.tsx`
- `AssistantMemorySettings.tsx`

Keep: `AssistantModelSettings.tsx`, `AssistantPromptSettings.tsx` (if used by selection actions).

### Redux Store Finalization

Final slice inventory — only these should remain:
- `settings`, `llm`, `selectionStore`
- `messages` (`newMessagesReducer`), `messageBlocks` (`messageBlocksReducer`)
- `runtime`
- `assistants` (if selection code depends on `getDefaultAssistant()`)

Update:
- `storeSyncService` sync list
- `persistReducer` blacklist
- `migrate.ts` migration logic

### Sidebar & Navigation Simplification

- `DEFAULT_SIDEBAR_ICONS`: only `'selection_assistant'`
- `REQUIRED_SIDEBAR_ICONS`: only `'selection_assistant'`
- `Router.tsx`: only `/selection` and `/settings/*` routes remain
- Default route: `/` → redirect to `/selection`
- Simplify `Sidebar.tsx` to minimal navigation

### Provider OAuth Simplification

Evaluate and remove OAuth-based provider services that add complexity without clear value for the selection assistant. The selection assistant primarily needs API-key-based providers.

**Services to evaluate:**
- `CherryINOAuthService` — PKCE OAuth for CherryIN platform. **REMOVE** — niche provider, adds `@cherrystudio/analytics-client` dependency.
  - Main: `src/main/services/CherryINOAuthService.ts`
  - Preload: `api.cherryin.*` (`saveToken`, `hasToken`, `getBalance`, `logout`, `startOAuthFlow`, `exchangeToken`)
  - Store: Clean `llm.cherryIn.accessToken` and `llm.cherryIn.refreshToken` fields
- `AnthropicService` (OAuth) — PKCE OAuth against `claude.ai`, stores credentials at `~/.config/cherry-studio/oauth/`. **EVALUATE** — if users should authenticate with Anthropic via OAuth, keep; if API key is sufficient, remove.
  - Main: `src/main/services/AnthropicService.ts`
  - Preload: `api.anthropic_oauth.*` (`startOAuthFlow`, `completeOAuthWithCode`, `cancelOAuthFlow`, `getAccessToken`, `hasCredentials`, `clearCredentials`)
- `VertexAIService` — Service account auth for Google Cloud Vertex AI. **EVALUATE** — if Gemini/Anthropic via Vertex is needed, keep; if direct API providers suffice, remove.
  - Main: `src/main/services/VertexAIService.ts`
  - IPC: `VertexAI_GetAuthHeaders`, `VertexAI_GetAccessToken`, `VertexAI_ClearAuthCache`

**Note**: `CopilotService` main process file should already be removed in Phase 08. Its store slice (`copilot`) and preload (`api.copilot.*`) are already removed in Phase 06.

### Settings Navigation Cleanup

Clean up orphaned `<Divider />` components in `SettingsPage.tsx`. Final menu flow:
```
Provider → Model → [divider] → General → Display → Shortcut → [divider] → About → Selection Assistant
```

## Out of Scope

- Package.json dependency cleanup (Phase 10)
- Type definitions, i18n, asset cleanup (Phase 10)
- Build configuration changes (Phase 10)

## Dependencies

### Previous Phases
- **Phases 01-07** (strongly recommended): The settings simplification assumes that the features being de-configured (MCP, Knowledge, Memory, Proxy, etc.) have already been removed. If a feature's backend still exists, removing its settings toggle will leave the feature stuck in whatever state it was in.
- **Phase 08** (recommended): Main process services should be cleaned before simplifying the settings that configure them.

### External Systems
- None.

## Deliverables

1. General Settings simplified (proxy, backup/knowledge notifications, privacy sections removed)
2. Display Settings simplified (sidebar icon manager and topic options removed)
3. Shortcut Settings simplified (removed-feature shortcuts deleted)
4. About Settings simplified (update checks and sponsor links removed)
5. Assistant Settings simplified (MCP, Knowledge, Memory sub-settings files deleted)
6. Redux store contains only required slices
7. `storeSyncService` sync list, `persistReducer` blacklist, and `migrate.ts` updated
8. Sidebar reduced to Selection Assistant + Settings only
9. Default route confirmed as `/selection`
10. Settings menu dividers cleaned up
11. App compiles, runs, and all UI flows cleanly

## Technical Tasks

### 1. Simplify `GeneralSettings.tsx`
- Remove proxy state variables (`proxyUrl`, `proxyBypassRules`, `storeProxyMode`) and their JSX sections
- Remove notification toggles for `backup` and `knowledge` — keep only `assistant`
- Remove privacy/data collection `SettingGroup`
- Remove unused imports: `setProxyMode`, `setProxyUrl`, `setProxyBypassRules`, `isValidProxyUrl`, `setEnableDataCollection`, `defaultByPassRules`

### 2. Simplify `DisplaySettings/`
- Delete `SidebarIconsManager.tsx`
- Remove topic display options, navbar position selector, assistant icon type sections from the main display settings component

### 3. Simplify `ShortcutSettings.tsx`
- Remove shortcut entries for: chat, agents, knowledge, topics, notes, paintings, files, translate, mini apps
- Keep: selection assistant shortcut, global hotkey configuration

### 4. Simplify `AboutSettings.tsx`
- Remove auto-update check UI and related state
- Remove update channel selector
- Remove sponsor links
- Keep: version display, app information

### 5. Simplify `AssistantSettings/`
- Delete: `AssistantMCPSettings.tsx`, `AssistantKnowledgeBaseSettings.tsx`, `AssistantMemorySettings.tsx`
- Keep: `AssistantModelSettings.tsx`, `AssistantPromptSettings.tsx`
- Update any parent component that renders the deleted sub-settings

### 6. Finalize Redux Store (`store/index.ts`)
Remove any remaining slices not in the keep list. After this edit, `combineReducers({})` should only contain:
```typescript
combineReducers({
  settings,
  llm,
  selectionStore,
  runtime,
  messages: newMessagesReducer,
  messageBlocks: messageBlocksReducer,
  // assistants,  ← include only if getDefaultAssistant() is used by selection code
})
```

Update `storeSyncService.setOptions()`:
```typescript
syncList: ['settings/', 'llm/', 'selectionStore/']
```

Update `persistReducer` blacklist:
```typescript
blacklist: ['runtime', 'messages', 'messageBlocks']
```

### 7. Update `migrate.ts`
- Remove migration logic for deleted slices
- Bump migration version if the store shape changed

### 8. Simplify Sidebar

Edit `src/renderer/src/config/sidebar.ts`:
```typescript
export const DEFAULT_SIDEBAR_ICONS: SidebarIcon[] = ['selection_assistant']
export const REQUIRED_SIDEBAR_ICONS: SidebarIcon[] = ['selection_assistant']
```

Edit `src/renderer/src/components/app/Sidebar.tsx`:
- Remove all sidebar items for deleted features
- Keep only: Selection Assistant, Settings gear icon

### 9. Confirm Router (`Router.tsx`)
Ensure only these routes remain:
```tsx
<Route path="/" element={<Navigate to="/selection" replace />} />
<Route path="/selection" element={<SelectionAssistantPage />} />
<Route path="/settings/*" element={<SettingsPage />} />
```

### 10. Clean SettingsPage dividers
Remove orphaned `<Divider />` components in `SettingsPage.tsx`. Verify the menu flows without visual gaps or double dividers.

### 11. Verify
```bash
pnpm format && pnpm build:check
pnpm dev
```
Manual verification: app opens to `/selection`, sidebar only shows selection + settings, all settings pages render correctly, no dead toggle switches.

## Acceptance Criteria

- [ ] `pnpm build:check` passes
- [ ] App opens to `/selection` page by default
- [ ] Sidebar only shows Selection Assistant and Settings
- [ ] General Settings: no proxy, no backup/knowledge notifications, no privacy section
- [ ] Display Settings: no sidebar icon manager, no topic options
- [ ] Shortcut Settings: only selection-related shortcuts
- [ ] About Settings: no update checks, no sponsor links
- [ ] Redux store only contains required slices
- [ ] Settings menu has clean divider layout, no gaps or orphaned dividers
- [ ] Selection Assistant functions correctly end-to-end

## Clarifications Needed

- **`assistants` slice final disposition**: The PRD says "Evaluate: may be needed for default assistant resolution." Before removing, search for all references to `getDefaultAssistant()` or `state.assistants` in selection-related code. If any exist, the slice must stay.
- **`shortcuts` slice**: If not removed in Phase 06, evaluate here whether any remaining code reads from it.
- **Navbar position**: The PRD says to remove the navbar position selector from Display Settings. Verify which position the app should default to after removal (likely `'left'` or `'top'`), and hardcode it if the selector is removed.
- **`AnthropicService` OAuth vs API key**: Determine if Anthropic OAuth login (via `claude.ai`) provides meaningful value over API-key authentication for the selection assistant use case. If API key is sufficient, remove the OAuth flow.
- **`VertexAIService` necessity**: Determine if any target users need Google Cloud Vertex AI access. If direct Gemini/Anthropic API access is sufficient, remove VertexAI auth support.

## Summary of Previous Phases

- **Phase 01**: Removed Paintings, Code Tools, OpenClaw, Mini Apps, Launchpad pages.
- **Phase 02**: Removed Knowledge Bases, File Manager, Doc Processing Settings.
- **Phase 03**: Removed Notes, Memory features with persistor callback cleanup.
- **Phase 04**: Removed MCP, Web Search, API Server Settings.
- **Phase 05**: Removed Sync/Backup/Proxy, Data Settings, Agent Store/Presets.
- **Phase 06**: Removed Standalone Translate, Quick Phrase/Assistant, Agent Settings, Copilot.
- **Phase 07**: Extracted MessageContent, removed Home/Chat, changed default route to `/selection`.
- **Phase 08**: Cleaned remaining main process services and preload API namespaces.

## Next Phase Preview

**Phase 10: Clean Dependencies, Types, Assets & Build Config** is the final phase. It removes ~150+ unused npm dependencies from `package.json`, deletes dead TypeScript type definitions, strips orphaned i18n translation keys, removes unused assets/icons, simplifies the Vite and Electron Builder configurations, and deletes tests for removed features. After this phase, the trimming is complete.
