# Phase 02: Remove Knowledge & Files Features

## Overall Product Objective

Transform the full-featured Cherry Studio Electron app (~1545 source files, ~346 npm dependencies) into a lightweight Quick Selection Assistant utility — a fast, focused tool for AI-powered text actions (summarize, translate, explain, refine, custom prompts) — targeting ~150-200 source files and ~100-130 npm dependencies.

## Phase Goal

Remove the Knowledge Bases system, File Manager, and Document Processing features — including their pages, backend services, store slices, preload namespaces, and the Doc Processing settings sub-route. These features manage RAG/embedding pipelines and file operations that the selection assistant does not use.

## Scope

- **Knowledge Bases page** (`/knowledge`) — RAG, embeddings, vector search
- **File Manager page** (`/files`) — File browsing and management UI
- **Doc Processing Settings** (`/settings/docprocess`) — OCR providers, document preprocessing config
- **Backend services**: `KnowledgeService`, `FileManagerService`, `FileStorageService`
- **Renderer services**: `KnowledgeService.ts`, `FileService.ts`
- **Store slices**: `knowledge`, `ocr`, `preprocess`
- **Preload namespaces**: `api.knowledgeBase.*`, `api.fileService.*`, `api.file.*`, `api.ocr.*`

## Out of Scope

- Notes & Memory features (Phase 03)
- MCP & Web Search features (Phase 04)
- Home/Chat page removal (Phase 07)
- Package.json dependency removal for `pdf-parse`, `mammoth`, `sharp`, etc. (Phase 10)

## Dependencies

### Previous Phases
- None — this phase is independently executable.

### External Systems
- None.

## Deliverables

1. Two page directories deleted (`knowledge/`, `files/`)
2. One settings sub-route directory deleted (`DocProcessSettings/`)
3. Three Redux store slices removed (`knowledge`, `ocr`, `preprocess`)
4. Three main process services deleted
5. Two renderer services deleted
6. Four preload namespaces removed
7. Sidebar cleaned of two icon entries
8. Settings page cleaned of Doc Processing route and menu item
9. App compiles and runs with `pnpm build:check`

## Technical Tasks

### 1. Edit `src/renderer/src/Router.tsx`
Remove imports:
- `import KnowledgePage from './pages/knowledge/KnowledgePage'`
- `import FilesPage from './pages/files/FilesPage'`

Remove routes:
- `<Route path="/knowledge" element={<KnowledgePage />} />`
- `<Route path="/files" element={<FilesPage />} />`

### 2. Edit `src/renderer/src/config/sidebar.ts`
Remove from `DEFAULT_SIDEBAR_ICONS`: `'knowledge'`, `'files'`

### 3. Edit `src/renderer/src/store/index.ts`
Remove imports and `combineReducers` entries:
- `import knowledge from './knowledge'`
- `import ocr from './ocr'`
- `import preprocess from './preprocess'`

### 4. Edit `src/renderer/src/pages/settings/SettingsPage.tsx`
- Remove import: `import DocProcessSettings from './DocProcessSettings'`
- Remove menu item block for `/settings/docprocess` (the `<MenuItemLink>` wrapping the FileCode icon)
- Remove route: `<Route path="docprocess" element={<DocProcessSettings />} />`

### 5. Edit `src/main/index.ts`
Remove initialization and cleanup calls for:
- `KnowledgeService`
- `FileManagerService`
- `FileStorageService`

### 6. Edit `src/preload/index.ts`
Remove API namespace groups:
- `api.knowledgeBase.*`
- `api.fileService.*`
- `api.file.*`
- `api.ocr.*`

### 7. Delete files and directories
```
rm -rf src/renderer/src/pages/knowledge/
rm -rf src/renderer/src/pages/files/
rm -rf src/renderer/src/pages/settings/DocProcessSettings/
rm -f  src/renderer/src/store/knowledge.ts
rm -f  src/renderer/src/store/ocr.ts
rm -f  src/renderer/src/store/preprocess.ts
rm -f  src/renderer/src/services/KnowledgeService.ts
rm -f  src/renderer/src/services/FileService.ts
rm -f  src/main/services/KnowledgeService.ts
rm -f  src/main/services/FileManagerService.ts
rm -f  src/main/services/FileStorageService.ts
```

### 8. Verify
```bash
pnpm format && pnpm build:check
```

## Acceptance Criteria

- [ ] `pnpm build:check` passes
- [ ] App launches without errors
- [ ] `/knowledge` and `/files` URLs show blank/404 — no crash
- [ ] Settings page no longer shows "Doc Processing" menu item
- [ ] Sidebar no longer shows Knowledge or Files icons
- [ ] No TypeScript errors referencing deleted modules
- [ ] Selection Assistant still functions correctly

## Summary of Previous Phases

- **Phase 01**: Removed Paintings, Code Tools, OpenClaw, Mini Apps, and Launchpad pages with their store slices, sidebar entries, and preload namespaces.

## Next Phase Preview

**Phase 03: Remove Notes & Memory Features** will remove the Notes page, Memory Settings sub-route, and their backend services. This phase requires special care because the `note` Redux slice has a cross-dependency in the `persistor` callback that must be removed simultaneously to prevent a boot crash.
