# Testing Strategy: Remove MCP & Web Search Features

**Branch**: `004-remove-mcp-websearch` | **Date**: 2026-03-04

## Overview

This phase is a code removal task. The testing strategy focuses on verification (nothing broke) rather than new test creation (nothing new to test). All exit criteria map directly to spec Success Criteria (SC-001 through SC-006).

---

## Exit Gate: `pnpm build:check`

The primary quality gate is `pnpm build:check`, which runs lint + test + TypeScript type-checking in sequence.

### Required passing commands (in order)

```bash
pnpm i18n:sync          # Step 0: Re-sync i18n template after key removals (run first if i18n keys changed)
pnpm format             # Step 1: Auto-format changed files with Biome
pnpm lint               # Step 2: ESLint + TypeScript type-check (0 errors required)
pnpm test               # Step 3: Run Vitest test suites (all must pass)
pnpm build:check        # Final gate: lint + test + typecheck combined
```

**Acceptance**: `pnpm build:check` must exit with code 0. Maps to SC-001.

---

## Test Categories

### Category 1: Build Integrity (SC-001, SC-002)

**What**: Confirm the application compiles with 0 TypeScript errors and 0 lint violations.

**How**:
1. After all file deletions and edits, run `pnpm lint`
2. Fix each reported TypeScript error (see frontend-spec.md cross-reference cleanup section)
3. Run `pnpm format` if Biome reports formatting issues
4. Run `pnpm build:check` for the final combined check

**Expected outcome**: Exit code 0 on `pnpm build:check`.

---

### Category 2: Settings UI Verification (SC-003)

**What**: Confirm the Settings page no longer shows MCP, Web Search, or API Server entries.

**How** (manual smoke test):
1. Launch the app with `pnpm dev`
2. Navigate to Settings
3. Verify the sidebar menu contains NO entries for MCP, Web Search, or API Server
4. Verify no orphaned dividers or blank spaces appear between remaining menu items
5. Attempt to navigate to `/settings/mcp`, `/settings/websearch`, `/settings/api-server` directly — app should not crash

**Expected outcome**: Settings sidebar contains exactly the expected items; removed routes do not cause crashes.

---

### Category 3: Selection Assistant Regression (SC-004)

**What**: Confirm all five Selection Assistant actions work correctly.

**How** (manual smoke test):
1. Select text in any application
2. Trigger the Selection Assistant overlay
3. Test each action:
   - **Summarize** → AI-powered result returned
   - **Translate** → AI-powered result returned
   - **Explain** → AI-powered result returned
   - **Refine** → AI-powered result returned
   - **Search** → Browser opens with `google.com/search?q=[selected text]`
4. Verify no errors appear in the Electron DevTools console related to deleted modules

**Expected outcome**: All five actions work; no console errors from deleted modules.

---

### Category 4: Persisted State Graceful Load (SC-005)

**What**: Confirm the app loads cleanly even if a previous session's persisted state included the removed slices.

**How**:
1. If possible, use a pre-existing app data directory that has previously persisted `mcp`, `websearch`, or `toolPermissions` state
2. Launch the app
3. Verify no crash or error dialog on startup
4. Verify the Redux store initializes normally (check with Redux DevTools if available)

**Expected outcome**: App loads without crashes; stale state keys are silently ignored.

---

### Category 5: File Count Reduction (SC-006)

**What**: Confirm the expected files were actually deleted.

**How**:
```bash
# Check that deleted directories are gone
ls src/renderer/src/pages/settings/MCPSettings/     # should fail (not found)
ls src/renderer/src/pages/settings/WebSearchSettings/  # should fail
ls src/renderer/src/pages/settings/ToolSettings/    # should fail

# Check that deleted store slices are gone
ls src/renderer/src/store/mcp.ts          # should fail
ls src/renderer/src/store/websearch.ts    # should fail
ls src/renderer/src/store/toolPermissions.ts  # should fail

# Check that deleted services are gone
ls src/main/services/MCPService.ts        # should fail
ls src/main/services/SearchService.ts     # should fail
```

**Expected outcome**: All expected paths return "not found". Approximately 15–25 files removed total.

---

## Existing Test Suite Impact

### Tests That May Need Deletion or Modification

After deleting aiCore utility files that reference removed store slices, corresponding test files may also fail. Known candidates:

| Test File | Expected Action |
|-----------|----------------|
| `src/renderer/src/aiCore/utils/__tests__/mcp.test.ts` | DELETE — tests utilities for deleted MCP code |
| `src/renderer/src/aiCore/utils/__tests__/websearch.test.ts` | DELETE — tests utilities for deleted WebSearch code |

**Rule**: If a test file's subject is entirely deleted, delete the test file too. If a test file tests a shared file where only some tests become invalid, remove those specific test cases.

`pnpm test` must pass after all cleanup.

---

## No New Tests Required

This phase removes functionality; no new test cases are added. The spec has no new functional behavior to validate beyond what `pnpm build:check` and manual smoke tests cover.
