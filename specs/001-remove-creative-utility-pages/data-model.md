# Data Model: Remove Creative & Utility Pages

**Branch**: `001-remove-creative-utility-pages` | **Date**: 2026-03-02

## Summary

This is a deletion task — no new entities are introduced. The following data structures are being **removed**:

### Redux Store Slices Removed

| Slice | File | Description |
|-------|------|-------------|
| `paintings` | `store/paintings.ts` | State for Paintings page (image generation settings, history) |
| `codeTools` | `store/codeTools.ts` | State for Code Tools page (sandbox config, execution history) |
| `openclaw` | `store/openclaw.ts` | State for OpenClaw page (integration settings) |

### Redux Store Slice Deferred

| Slice | File | Reason |
|-------|------|--------|
| `minapps` | `store/minapps.ts` | Used by 5 surviving core components (Sidebar, TabContainer, MinApp, MinappPopupContainer, PinnedMinapps). Deferred to Phase 07/09. |

### Preload API Namespaces Removed

| Namespace | Methods | Consumer |
|-----------|---------|----------|
| `api.openclaw.*` | IPC calls for OpenClaw integration | OpenClawPage |
| `api.codeTools.*` | IPC calls for code execution sandbox | CodeToolsPage |
| `api.ovms.*` | `isSupported`, `addModel`, `stopAddModel`, `getModels`, `isRunning`, `getStatus`, `runOvms`, `stopOvms` | Paintings/OVMS UI |
| `api.installOvmsBinary` | Single IPC call for OVMS binary installation | Paintings/OVMS UI |

### Persisted State Handling

Redux-persist stores serialized state in localStorage. When slices are removed from the reducer, redux-persist silently ignores unknown keys in the persisted data. No migration is needed — stale `paintings`, `codeTools`, and `openclaw` keys will be harmlessly orphaned in storage and eventually overwritten.

### Constants Relocated

| Constant | From | To | Reason |
|----------|------|----|--------|
| `CLAUDE_SUPPORTED_PROVIDERS` | `pages/code/index.ts` | `utils/provider.ts` (inlined) | Used by surviving code in `utils/provider.ts`; source file being deleted |
