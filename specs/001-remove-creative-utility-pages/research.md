# Research: Remove Creative & Utility Pages

**Branch**: `001-remove-creative-utility-pages` | **Date**: 2026-03-02

## Cross-Dependency Audit Results

A comprehensive audit of all files to be removed was conducted. Three critical cross-dependencies were discovered.

### Decision 1: `CLAUDE_SUPPORTED_PROVIDERS` must be relocated

- **Finding**: `src/renderer/src/utils/provider.ts` imports `CLAUDE_SUPPORTED_PROVIDERS` from `pages/code/index.ts`. This utility is used by surviving code.
- **Decision**: Move the constant to `src/renderer/src/config/providers.ts` (or inline it in `utils/provider.ts`) before deleting `pages/code/`.
- **Rationale**: A simple relocation preserves existing behavior with minimal diff.
- **Alternatives considered**: (1) Inline the constant directly in `utils/provider.ts` — simplest, chosen. (2) Create a new shared config file — adds a file, overkill for one constant.

### Decision 2: `store/minapps` and related components must be DEFERRED

- **Finding**: `store/minapps` and `hooks/useMinapps` are used by 5 surviving core components:
  - `components/app/PinnedMinapps.tsx`
  - `components/app/Sidebar.tsx`
  - `components/MinApp/MinApp.tsx`
  - `components/MinApp/MinappPopupContainer.tsx`
  - `components/Tab/TabContainer.tsx`
- **Decision**: Remove the **page routes** and **sidebar icon** for Mini Apps/Launchpad, but KEEP `store/minapps`, `hooks/useMinapps`, and `components/MinApp/`. Defer full removal to Phase 07/09 when these core components are also being modified.
- **Rationale**: Removing the store slice would require modifying 5+ core components in Phase 01, violating the "safest, lowest-risk entry point" principle.
- **Alternatives considered**: (1) Remove everything including store + fix 5 components — too invasive for Phase 01. (2) Keep everything (no removal) — pages are still removable as routes.

### Decision 3: OVMS removal is partially blocked by main process and Settings

- **Finding**: `OvmsManager` is imported in `src/main/index.ts` (quit handler) and `src/main/ipc.ts` (7 IPC handlers). `OVMSClient` is referenced in `ApiClientFactory.ts`. Settings pages (`OVMSSettings.tsx`, `DownloadOVMSModelPopup.tsx`, `ProviderList.tsx`) use `api.ovms`.
- **Decision**: Remove the Paintings page directory (which contains OVMS UI). Remove `api.ovms.*` preload namespace. Remove IPC handlers for `Ovms_*` in `ipc.ts`. Remove OvmsManager import from `main/index.ts`. Remove `OVMSClient` from `ApiClientFactory`. Remove OVMS Settings components. Delete `OvmsManager.ts` and `aiCore/legacy/clients/ovms/`.
- **Rationale**: OVMS is exclusively a Paintings feature. All its tendrils (main process, IPC, settings, AI client factory) should be removed together to avoid orphan code. The settings pages for OVMS are meaningless without the service.
- **Alternatives considered**: (1) Defer OVMS entirely to Phase 08 — leaves orphan IPC handlers and settings pages. (2) Remove only the page — leaves OVMS as a ghost feature with no UI entry point but still loaded at quit.

### Decision 4: Test mock needs updating

- **Finding**: `src/renderer/src/services/__tests__/ApiService.test.ts:147` mocks `store/paintings`.
- **Decision**: Update or remove the mock when deleting the paintings store slice.
- **Rationale**: Test mocks that reference deleted modules will fail TypeScript compilation.

### Decision 5: OpenClaw and Launchpad are fully safe

- **Finding**: `pages/openclaw/` and `pages/launchpad/` have zero external imports. All `api.openclaw` usage is confined to `OpenClawPage.tsx`. Launchpad only references `useMinapps` (which is being kept).
- **Decision**: Remove fully as planned.

## Revised Scope Summary

| Feature | Page Dir | Routes | Sidebar | Store Slice | Preload NS | Main Process | Settings |
|---------|----------|--------|---------|-------------|------------|--------------|----------|
| Paintings | REMOVE | REMOVE | REMOVE | REMOVE | N/A | N/A | N/A |
| OVMS | (with Paintings) | N/A | N/A | N/A | REMOVE | REMOVE | REMOVE |
| Code Tools | REMOVE (after relocation) | REMOVE | REMOVE | REMOVE | REMOVE | N/A | N/A |
| OpenClaw | REMOVE | REMOVE | REMOVE | REMOVE | REMOVE | N/A | N/A |
| Mini Apps | REMOVE pages only | REMOVE | REMOVE | **DEFER** | N/A | N/A | N/A |
| Launchpad | REMOVE | REMOVE | N/A | N/A | N/A | N/A | N/A |
