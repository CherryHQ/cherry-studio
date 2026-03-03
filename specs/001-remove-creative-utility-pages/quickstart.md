# Quickstart: Remove Creative & Utility Pages

**Branch**: `001-remove-creative-utility-pages` | **Date**: 2026-03-02

## Prerequisites

- Node.js 18+ and pnpm installed
- Repository cloned and on branch `001-remove-creative-utility-pages`

## Setup

```bash
pnpm install
```

## Verification After Implementation

### 1. Build Check (Required — P1)

```bash
pnpm format && pnpm build:check
```

This runs lint + typecheck + test. Must exit with code 0.

### 2. Development Launch (Required — P1)

```bash
pnpm dev
```

Verify:
- App launches without errors in the console
- Sidebar does NOT show: Paintings, Code Tools, OpenClaw, Mini Apps icons
- Remaining features work normally (Settings, Chat, Selection Assistant)

### 3. Selection Assistant End-to-End (Required — P1)

1. Select text in any application
2. Trigger the selection toolbar
3. Choose an action (summarize, translate, explain, etc.)
4. Verify the AI streaming response completes successfully

### 4. Removed Route Navigation (P2)

Navigate to each removed URL path in the app's address bar:
- `/paintings` — should show blank/fallback, no crash
- `/code` — should show blank/fallback, no crash
- `/openclaw` — should show blank/fallback, no crash
- `/apps` — should show blank/fallback, no crash
- `/launchpad` — should show blank/fallback, no crash

### 5. File Deletion Verification

Confirm these directories/files no longer exist:
```bash
ls src/renderer/src/pages/paintings/    # Should not exist
ls src/renderer/src/pages/code/         # Should not exist
ls src/renderer/src/pages/openclaw/     # Should not exist
ls src/renderer/src/pages/minapps/      # Should not exist
ls src/renderer/src/pages/launchpad/    # Should not exist
ls src/renderer/src/store/paintings.ts  # Should not exist
ls src/renderer/src/store/codeTools.ts  # Should not exist
ls src/renderer/src/store/openclaw.ts   # Should not exist
ls src/main/services/OvmsManager.ts     # Should not exist
ls src/renderer/src/aiCore/legacy/clients/ovms/  # Should not exist
```

### 6. Deferred Items (Do NOT Remove)

These must still exist after Phase 01:
```bash
ls src/renderer/src/store/minapps.ts    # Should STILL exist (deferred)
ls src/renderer/src/hooks/useMinapps.ts # Should STILL exist (deferred)
```
