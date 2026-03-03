# Tasks: Remove Creative & Utility Pages

**Input**: Design documents from `/specs/001-remove-creative-utility-pages/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: Not explicitly requested in the feature specification. Test tasks are limited to fixing the existing broken test mock (T016) and the build pipeline verification (T018).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Verify working tree and establish prerequisites

- [x] T001 Verify git branch is `001-remove-creative-utility-pages` and working tree is clean

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Resolve cross-dependencies that MUST be addressed before any page directories can be deleted

**⚠️ CRITICAL**: T002 must complete before Phase 3 file deletions. The `pages/code/` directory cannot be deleted until `CLAUDE_SUPPORTED_PROVIDERS` is relocated — it is imported by surviving code in `utils/provider.ts`.

- [x] T002 Inline `CLAUDE_SUPPORTED_PROVIDERS` constant from `src/renderer/src/pages/code/index.ts` into `src/renderer/src/utils/provider.ts` and update the import to use the local definition

**Checkpoint**: Foundational prerequisite resolved — Code Tools page directory is now safe to delete

---

## Phase 3: User Story 1 — Application Launches Without Removed Features (Priority: P1) 🎯 MVP

**Goal**: Remove all six standalone page features (Paintings, OVMS, Code Tools, OpenClaw, Mini Apps, Launchpad) from every layer — routes, sidebar, store, preload, main process, settings, and file system. The app launches normally with the sidebar showing four fewer icons.

**Independent Test**: Run `pnpm dev`, verify the app starts, sidebar has no Paintings/Code Tools/OpenClaw/Mini Apps icons, and Selection Assistant works end-to-end.

### Hub File Edits (parallelizable — each touches a different file)

- [x] T003 [P] [US1] Remove OvmsManager import and quit-handler cleanup call from `src/main/index.ts`
- [x] T004 [P] [US1] Remove all OVMS IPC handlers (`Ovms_*` — 7 handlers) from `src/main/ipc.ts`
- [x] T005 [P] [US1] Remove `OVMSClient` reference from the AI client factory in `src/renderer/src/aiCore/` (e.g., `ApiClientFactory.ts` or equivalent)
- [x] T006 [P] [US1] Remove OVMS settings components (`OVMSSettings.tsx`, `DownloadOVMSModelPopup.tsx`) and their imports from `src/renderer/src/pages/settings/` files (e.g., `ProviderList.tsx` or provider settings index)
- [x] T007 [P] [US1] Remove four preload IPC namespaces (`api.ovms.*`, `api.installOvmsBinary`, `api.openclaw.*`, `api.codeTools.*`) from `src/preload/index.ts`
- [x] T008 [P] [US1] Remove 6 route entries and their lazy/direct imports (`PaintingsRoutePage`, `CodeToolsPage`, `OpenClawPage`, `MinAppPage`, `MinAppsPage`, `LaunchpadPage`) from `src/renderer/src/Router.tsx`
- [x] T009 [P] [US1] Remove 4 sidebar icon entries (`paintings`, `code_tools`, `openclaw`, `minapp`) from `DEFAULT_SIDEBAR_ICONS` array in `src/renderer/src/config/sidebar.ts`
- [x] T010 [P] [US1] Remove 3 reducer imports and `combineReducers` entries (`paintings`, `codeTools`, `openclaw`) from `src/renderer/src/store/index.ts` — keep `minapps` (deferred per research Decision 2)
- [x] T011 [P] [US1] Clean any references to removed slices (`paintings`, `codeTools`, `openclaw`) from `src/renderer/src/store/migrate.ts`

### File Deletions (sequential — depends on hub file edits removing imports first)

- [x] T012 [US1] Delete 5 page directories: `src/renderer/src/pages/paintings/`, `src/renderer/src/pages/code/`, `src/renderer/src/pages/openclaw/`, `src/renderer/src/pages/minapps/`, `src/renderer/src/pages/launchpad/`
- [x] T013 [US1] Delete 3 store slice files: `src/renderer/src/store/paintings.ts`, `src/renderer/src/store/codeTools.ts`, `src/renderer/src/store/openclaw.ts`
- [x] T014 [US1] Delete OVMS service and AI client: `src/main/services/OvmsManager.ts` and `src/renderer/src/aiCore/legacy/clients/ovms/`

**Checkpoint**: All six features removed. App should launch with sidebar showing four fewer icons. Selection Assistant unaffected.

---

## Phase 4: User Story 2 — Removed Routes Do Not Crash the App (Priority: P2)

**Goal**: Navigating to any of the five removed URL paths (`/paintings`, `/code`, `/openclaw`, `/apps`, `/launchpad`) does not crash the application — it shows a blank page or redirects gracefully.

**Independent Test**: Manually navigate to each removed URL in the app's address bar and verify no crash.

**Note**: This story is largely satisfied by US1's route removal (T008). The app's `HashRouter` will render nothing for unmatched routes. This phase verifies that behavior and adds a catch-all fallback route if one does not already exist.

- [x] T015 [US2] Verify `src/renderer/src/Router.tsx` has a catch-all fallback route (e.g., `<Route path="*" ... />`) that prevents crashes on unmatched paths — add one if missing

**Checkpoint**: Navigating to removed paths shows blank/fallback page, no crash.

---

## Phase 5: User Story 3 — Build Pipeline Passes After Removal (Priority: P1)

**Goal**: The full build pipeline (`pnpm build:check` — lint + typecheck + test) passes with zero errors. No dangling imports, unresolved references, or broken type definitions.

**Independent Test**: Run `pnpm build:check` and verify exit code 0.

  - [x] T016 [US3] Update or remove the `store/paintings` mock in `src/renderer/src/services/__tests__/ApiService.test.ts` (line ~147) so it no longer references the deleted module
- [x] T017 [US3] Run `pnpm format` to auto-format all modified files
- [x] T018 [US3] Run `pnpm build:check` (lint + typecheck + test) and fix any remaining dangling references or type errors until exit code 0

**Checkpoint**: Build pipeline passes. Zero TypeScript errors, lint issues, or test failures.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation against quickstart.md acceptance criteria

- [x] T019 Run quickstart.md verification steps: confirm all deleted directories/files are gone, deferred items (`store/minapps.ts`, `hooks/useMinapps.ts`) still exist, and Selection Assistant end-to-end workflow completes successfully

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS Code Tools page deletion in Phase 3
- **US1 (Phase 3)**: Depends on Foundational (T002) — the core removal work
- **US2 (Phase 4)**: Depends on US1 (T008 specifically — routes must be removed first to test fallback behavior)
- **US3 (Phase 5)**: Depends on US1 + US2 completion — cannot verify build until all removals are done
- **Polish (Phase 6)**: Depends on US3 passing — final validation

### Critical Path

```text
T001 → T002 → [T003..T011 in parallel] → [T012..T014 sequential] → T015 → T016 → T017 → T018 → T019
```

### Within Phase 3 (US1)

- **T003–T011** are all parallelizable (each touches a different file)
- **T012–T014** are sequential and depend on T003–T011 completing (imports must be removed before files can be deleted)
- T012 depends specifically on T008 (Router.tsx imports removed before page dirs deleted)
- T013 depends on T010 (store/index.ts imports removed before slice files deleted)
- T014 depends on T003, T004, T005, T007 (all OVMS references removed before OVMS files deleted)

### Parallel Opportunities

```text
# Phase 3 parallel group (9 tasks on different files):
T003: src/main/index.ts
T004: src/main/ipc.ts
T005: src/renderer/src/aiCore/... (ApiClientFactory)
T006: src/renderer/src/pages/settings/... (OVMS settings)
T007: src/preload/index.ts
T008: src/renderer/src/Router.tsx
T009: src/renderer/src/config/sidebar.ts
T010: src/renderer/src/store/index.ts
T011: src/renderer/src/store/migrate.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (verify branch)
2. Complete Phase 2: Foundational (relocate constant)
3. Complete Phase 3: User Story 1 (all removals)
4. **STOP and VALIDATE**: Launch app with `pnpm dev`, verify sidebar, test Selection Assistant
5. If stable, proceed to US2 + US3 verification

### Sequential Delivery (Recommended for Solo Developer)

1. Setup + Foundational → Constant relocated
2. US1 hub file edits (T003–T011) → All parallel, execute together
3. US1 file deletions (T012–T014) → Sequential, execute in order
4. US2 verification (T015) → Quick check/fix
5. US3 build fix + verify (T016–T018) → Fix test mock, format, build:check
6. Polish (T019) → Final quickstart validation

---

## Notes

- [P] tasks = different files, no dependencies between them
- [Story] label maps each task to its user story for traceability
- `store/minapps.ts` and `hooks/useMinapps` are intentionally KEPT (deferred to Phase 07/09 per research Decision 2)
- OVMS removal spans 5 files (T003, T004, T005, T006, T007) — all must complete before T014 deletes OVMS source files
- The `api.ovms.*` and `api.openclaw.*` / `api.codeTools.*` preload namespaces are combined in T007 (single file edit)
- Commit after each logical group (foundational, hub file edits, file deletions, verification)
