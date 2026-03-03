# Phase 01: Remove Creative & Utility Pages

## Overall Product Objective

Transform the full-featured Cherry Studio Electron app (~1545 source files, ~346 npm dependencies) into a lightweight Quick Selection Assistant utility — a fast, focused tool for AI-powered text actions (summarize, translate, explain, refine, custom prompts) — targeting ~150-200 source files and ~100-130 npm dependencies.

## Phase Goal

Remove all standalone "creative and utility" page features that have zero cross-dependencies with the selection assistant or any other feature. This is the safest, lowest-risk entry point into the trimming process — a confidence-building first cut.

## Scope

Remove these features as complete vertical slices (page route + sidebar entry + Redux store slice + main process service + preload namespace):

- **Paintings** — Image generation page (`/paintings`)
- **OVMS (OpenVINO Model Server)** — Local image generation backend (`OvmsManager`, `OVMSClient`), part of the Paintings subsystem
- **Code Tools** — Code execution/sandbox page (`/code`)
- **OpenClaw** — OpenClaw integration page (`/openclaw`)
- **Mini Apps** — Mini programs pages (`/apps`, `/apps/:appId`)
- **Launchpad** — Mini Apps grid page (`/launchpad`)

## Out of Scope

- Home/Chat page (Phase 07)
- Knowledge, Files, Notes pages (Phase 02, 03)
- Translate, Store/Presets pages (Phase 05, 06)
- Settings sub-routes (later phases)
- Main process services not directly tied to these features
- Package.json dependency cleanup (Phase 10)

## Dependencies

### Previous Phases
- None — this is Phase 01.

### External Systems
- None.

## Deliverables

1. Five page directories deleted (`paintings/`, `code/`, `openclaw/`, `minapps/`, `launchpad/`)
2. Four Redux store slices removed (`paintings`, `codeTools`, `openclaw`, `minapps`)
3. Router.tsx cleaned of six route entries and their imports
4. Sidebar config cleaned of four icon entries
5. Preload namespaces removed (`api.openclaw.*`, `api.codeTools.*`, `api.ovms.*`, `api.installOvmsBinary`)
6. Main process init cleaned of OpenClaw, Mini App, and OVMS related initialization
7. OVMS main process service and renderer AI client deleted
8. App compiles and runs with `pnpm build:check`

## Technical Tasks

### 1. Edit `src/renderer/src/Router.tsx`
Remove these imports:
- `import PaintingsRoutePage from './pages/paintings/PaintingsRoutePage'`
- `import CodeToolsPage from './pages/code/CodeToolsPage'`
- `import OpenClawPage from './pages/openclaw/OpenClawPage'`
- `import MinAppPage from './pages/minapps/MinAppPage'`
- `import MinAppsPage from './pages/minapps/MinAppsPage'`
- `import LaunchpadPage from './pages/launchpad/LaunchpadPage'`

Remove these `<Route>` entries:
- `<Route path="/paintings/*" element={<PaintingsRoutePage />} />`
- `<Route path="/code" element={<CodeToolsPage />} />`
- `<Route path="/openclaw" element={<OpenClawPage />} />`
- `<Route path="/apps/:appId" element={<MinAppPage />} />`
- `<Route path="/apps" element={<MinAppsPage />} />`
- `<Route path="/launchpad" element={<LaunchpadPage />} />`

### 2. Edit `src/renderer/src/config/sidebar.ts`
Remove from `DEFAULT_SIDEBAR_ICONS` array:
- `'paintings'`
- `'code_tools'`
- `'openclaw'`
- `'minapp'`

### 3. Edit `src/renderer/src/store/index.ts`
Remove these import statements:
- `import codeTools from './codeTools'`
- `import openclaw from './openclaw'`
- `import paintings from './paintings'`
- `import minapps from './minapps'`

Remove the corresponding entries from the `combineReducers({})` call:
- `codeTools,`
- `openclaw,`
- `paintings,`
- `minapps,`

### 4. Edit `src/main/index.ts`
Remove any initialization or cleanup calls for:
- OpenClaw service (`openClawService`)
- Mini App related init (if any)
- OVMS manager (`ovmsManager`) — conditionally loaded on Intel Windows

### 5. Edit `src/preload/index.ts`
Remove these API namespace groups:
- `api.openclaw.*` (entire namespace object)
- `api.codeTools.*` (entire namespace object)
- `api.ovms.*` (entire namespace object — `isSupported`, `addModel`, `stopAddModel`, `getModels`, `isRunning`, `getStatus`, `runOvms`, `stopOvms`)
- `api.installOvmsBinary` (single IPC call)

### 6. Delete files and directories
```
rm -rf src/renderer/src/pages/paintings/
rm -rf src/renderer/src/pages/code/
rm -rf src/renderer/src/pages/openclaw/
rm -rf src/renderer/src/pages/minapps/
rm -rf src/renderer/src/pages/launchpad/
rm -f  src/renderer/src/store/paintings.ts
rm -f  src/renderer/src/store/codeTools.ts
rm -f  src/renderer/src/store/openclaw.ts
rm -f  src/renderer/src/store/minapps.ts
rm -f  src/main/services/OvmsManager.ts
rm -rf src/renderer/src/aiCore/legacy/clients/ovms/
```

### 7. Verify
```bash
pnpm format && pnpm build:check
```

## Acceptance Criteria

- [ ] `pnpm build:check` passes (lint + typecheck + test)
- [ ] App launches with `pnpm dev` without errors
- [ ] Navigating to `/paintings`, `/code`, `/openclaw`, `/apps`, `/launchpad` in the URL bar shows a blank or 404 — no crash
- [ ] Sidebar no longer shows Paintings, Code Tools, OpenClaw, Mini Apps icons
- [ ] No TypeScript errors referencing deleted modules
- [ ] Selection Assistant still functions (select text → toolbar → action window → AI response)

## Summary of Previous Phases

_(None — this is Phase 01)_

## Next Phase Preview

**Phase 02: Remove Knowledge & Files Features** will remove the Knowledge Bases page, File Manager page, and Doc Processing Settings sub-route. It follows the same vertical-slice pattern and is equally low-risk since these features have no cross-dependencies with the selection assistant.
