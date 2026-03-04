# Specification Review Checklist: Remove MCP & Web Search Features

**Purpose**: Validate specification completeness, clarity, consistency, and measurability before implementation — "unit tests for requirements writing"
**Created**: 2026-03-04
**Feature**: [spec.md](../spec.md)
**Depth**: Standard | **Audience**: Reviewer (pre-implement)

---

## Requirement Completeness

- [x] CHK001 - Is the complete set of files and directories to delete enumerated in requirements (not only in tasks), so the deletion scope is traceable to a functional requirement? [Completeness, Spec §FR-009, Gap]
- [x] CHK002 - Does FR-008 explicitly name all four IPC namespaces to be removed (`mcp`, `searchService`, `agentTools`, `apiServer`), or does it describe them only generically? [Completeness, Spec §FR-008]
- [x] CHK003 - Does FR-011 identify all three locale files (`en-us.json`, `zh-cn.json`, `zh-tw.json`) or only refer to "locale files" without specifying which? [Completeness, Spec §FR-011]
- [x] CHK004 - Does FR-011 name the specific i18n key subtrees to remove (`settings.mcp`, `settings.tool.websearch`, `apiServer`) rather than relying on implicit derivation from deleted features? [Completeness, Spec §FR-011, Gap]
- [x] CHK005 - Is the deletion of test files (`mcp.test.ts`, `websearch.test.ts`) covered by any functional requirement, or does it exist only as a task with no requirement traceability? [Completeness, Gap]

---

## Requirement Clarity

- [x] CHK006 - Is "orphaned UI elements" in FR-010 specific enough to be unambiguous — does the spec or a referenced artifact enumerate the exact elements: `McpLogo` icon, `Search` icon, `Server` icon, and the `<Divider />` above the MCP menu group? [Clarity, Spec §FR-010]
- [x] CHK007 - Is "exclusively associated with the removed settings sections" in FR-011 clearly bounded — does the spec define what makes a key "exclusive" to avoid under- or over-removal? [Clarity, Spec §FR-011, Ambiguity]
- [x] CHK008 - Is FR-002 ("compile successfully with no compilation errors") aligned with the specific `pnpm build:check` exit gate, which includes lint, typecheck, AND tests — or does it cover only TypeScript compilation? [Clarity, Spec §FR-002, SC-001]
- [x] CHK009 - Is "approximately 15–20 files removed" in SC-006 derivable from the task list, or is the range unverified and potentially inconsistent with the actual file count in tasks.md? [Clarity, Spec §SC-006, Measurability]
- [x] CHK010 - Are "all five Selection Assistant actions" in SC-004 named explicitly (summarize, translate, explain, refine, browser-search), or are they only implicitly identifiable? [Clarity, Spec §SC-004]
- [x] CHK011 - Is "removed from the main application process" in FR-009 precise enough to distinguish: main-process services to delete vs. renderer services to delete vs. the `ApiServerService.ts` file which is explicitly retained? [Clarity, Spec §FR-009, Ambiguity]
- [x] CHK012 - Is "remaining stable at runtime" in FR-003 verifiable — are specific stability indicators defined (crash-free launch, no uncaught exceptions on startup), or is "stable" left undefined? [Clarity, Spec §FR-003, Measurability]

---

## Requirement Consistency

- [x] CHK013 - Does Assumption #2 ("no other features outside of Settings reference or depend on the MCP, Web Search, or API Server systems") contradict the known cross-reference problem (aiCore/home-page imports from deleted slices) — and if so, is the contradiction resolved in the spec? [Consistency, Spec §Assumptions, Conflict]
- [x] CHK014 - Is there a conflict between FR-002 (build must pass with zero errors) and Assumption #5 (features scheduled for removal may degrade after this phase) — does the spec explicitly resolve that degraded Chat features must still compile cleanly? [Consistency, Spec §FR-002, Assumptions, Clarifications]
- [x] CHK015 - Are FR-004 (browser-URL search stays functional) and FR-005 (all Selection Assistant actions remain functional) consistent — or is FR-004 redundant since FR-005 already covers all five actions including browser-search? [Consistency, Spec §FR-004, FR-005]
- [x] CHK016 - Is SC-003 ("Settings navigation contains exactly zero references") consistent in scope with FR-001 — or does SC-003 only cover menu items while FR-001 also covers routes and orphaned UI? [Consistency, Spec §FR-001, SC-003]
- [x] CHK017 - Is the term "orphaned" used consistently across FR-010 (orphaned UI elements), FR-011 (orphaned i18n keys), and the Edge Cases section (orphaned dividers) — or does it carry different meanings across sections? [Consistency, Ambiguity]

---

## Acceptance Criteria Quality

- [x] CHK018 - Is US2 Acceptance Scenario 3 ("graceful navigation to a removed settings route") measurable — is the expected behavior (redirect to a valid route, 404-equivalent page, or silent no-op) explicitly defined? [Measurability, Spec §US2 Scenario 3]
- [x] CHK019 - Is "100% success rate" in SC-004 testable without a per-action definition of what constitutes a "success" for each of the five Selection Assistant actions individually? [Measurability, Spec §SC-004]
- [x] CHK020 - Is SC-002 ("no console errors related to removed modules") objectively verifiable — is the scope of "console errors" defined as renderer DevTools console only, or does it also include main-process logs? [Clarity, Spec §SC-002]
- [x] CHK021 - Is SC-005 ("app degrades gracefully" on stale persisted state) measurable — does the spec define "graceful" as crash-free startup specifically, or is it left to interpreter judgment? [Measurability, Spec §SC-005]

---

## Scenario Coverage

- [x] CHK022 - Is there a requirement (not just a task) covering the cross-reference cleanup path — that is, files in `aiCore/`, `hooks/`, and `pages/home/` which import from the deleted store slices and will cause TypeScript build errors? [Coverage, Research Finding 1, Gap]
- [x] CHK023 - Does any requirement address the conditional nature of ApiServerService cleanup — that the service file itself is retained while only its initialization block (in `main/index.ts`) and preload namespace are removed? [Coverage, Spec §FR-008, FR-009, Gap]
- [x] CHK024 - Does any task in tasks.md cover the implementation of US2 Acceptance Scenario 3 (graceful handling of direct navigation to a removed settings route) — or is this scenario specified but unimplemented? [Coverage, Spec §US2 Scenario 3, /6.analyze M1]
- [x] CHK025 - Is there a requirement covering the `pnpm i18n:sync` step that must run after i18n key removals to re-synchronize the template — or is this an unspecified prerequisite for FR-011? [Coverage, Spec §FR-011, Gap]

---

## Edge Case Coverage

- [x] CHK026 - Does Edge Case 1 (stale persisted state from a previous session) specify the exact pass condition — is "gracefully ignore" defined as crash-free load, or must specific error suppression be confirmed? [Edge Cases, Spec §Edge Cases, Clarity]
- [x] CHK027 - Does Edge Case 2 (shared UI components exclusively used by removed sections) identify specifically which `<Divider />` instance to remove (the one between Data Settings and MCP) versus which to retain (the one before Quick Phrase)? [Edge Cases, Spec §Edge Cases, Research Finding 2, Clarity]
- [x] CHK028 - Does Edge Case 3 (code paths outside Settings referencing deleted services) define the full scope of files to inspect — including `aiCore/utils/`, `config/models/__tests__/`, and any hooks beyond the two exclusively-wrapping ones? [Edge Cases, Spec §Edge Cases, /6.analyze H2, Ambiguity]

---

## Dependencies & Assumptions

- [x] CHK029 - Is Assumption #3 (`@modelcontextprotocol/*` npm package removal is out of scope for Phase 04) explicitly documented with a reference to which phase owns the package removal? [Assumption, Spec §Assumptions]
- [x] CHK030 - Is Assumption about redux-persist silently ignoring removed slice keys a validated claim backed by library documentation — or an unverified assumption that could fail if the persisted store version triggers a migration? [Assumption, Spec §Assumptions, Risk]
- [x] CHK031 - Is the dependency that Phase 2 file deletions MUST complete before any Phase 3+ editing tasks begin captured as a requirement or constraint — or does it exist only as a task-level note? [Completeness, Gap]
- [x] CHK032 - Is the Assumption that ApiServerService.ts is kept (only its init/cleanup and preload namespace removed) clearly documented as an explicit scope boundary decision with rationale? [Assumption, Spec §Assumptions, Research Finding 4]

---

## Ambiguities & Conflicts

- [x] CHK033 - Is FR-007 ("persistence exclusion list must be updated") clearly mapped to the specific `blacklist` array in the `persistReducer` config — or could "exclusion list" be misread as referring to a different persistence mechanism? [Clarity, Spec §FR-007, Ambiguity]
- [x] CHK034 - Does FR-006 ("state management MUST NOT include state slices for MCP, Web Search, or Tool Permissions") unambiguously scope to Redux store slices only — excluding i18n state, component local state, or other state mechanisms? [Clarity, Spec §FR-006]

---

## Notes

- Check items off as completed: `[x]`
- Items marked `[Gap]` indicate requirements that are absent and may need to be added to spec.md
- Items marked `[Conflict]` indicate requirements that contradict each other or contradict research.md findings
- Items marked `[Ambiguity]` indicate requirements that are present but unclear enough to cause misimplementation
- Items marked `[Risk]` indicate unverified assumptions that could cause runtime failures
- See `/6.analyze` report for related HIGH issues: H1 (Assumption #2 conflict), H2 (T039 scope)

## Resolution Log — 2026-03-04

All 34 items resolved by updating `spec.md` and `tasks.md`:

**spec.md changes:**
- FR-002: Rewritten to explicitly reference `pnpm build:check` (lint + typecheck + Vitest tests, exit code 0); addresses CHK008
- FR-003: Added measurable stability definition (main window appears, no uncaught exceptions, no renderer console errors); addresses CHK012
- FR-006: Scoped to "Redux store" and `combineReducers` explicitly; addresses CHK034
- FR-007: Named the specific `blacklist` array and listed retained entries; addresses CHK033
- FR-008: Named all four IPC namespaces (`mcp`, `searchService`, `agentTools`, `apiServer`); addresses CHK002
- FR-009: Named specific service files deleted vs retained (ApiServerService.ts kept); addresses CHK011, CHK023, CHK032
- FR-010: Enumerated exact orphaned elements (McpLogo, Search, Server icons, specific Divider); addresses CHK006, CHK027
- FR-011: Named all three locale files and specific key subtrees; added `pnpm i18n:sync` as mandatory step; addresses CHK003, CHK004, CHK007, CHK025
- FR-012 (NEW): Added requirement for cross-reference cleanup across all of `src/`; addresses CHK022, CHK001, CHK005
- SC-001: Updated to reference `pnpm build:check` exit code 0; addresses CHK008
- SC-002: Defined "console errors" scope as renderer DevTools console; addresses CHK020
- SC-003: Expanded to cover routes and orphaned elements, not just menu items; addresses CHK016
- SC-004: Added per-action success definition for all five actions; addresses CHK019
- SC-005: Defined "graceful" as crash-free startup with main window appearing; addresses CHK021
- SC-006: Grounded count in tasks.md Phase 2 (16 files + 3 dirs); addresses CHK009
- US2 Scenario 3: Defined expected outcome (blank content area or redirect, no crash, no unhandled errors); addresses CHK018
- Edge Cases: Improved specificity for all three cases — pass conditions, specific Divider identification, full cross-ref scope; addresses CHK026, CHK027, CHK028
- Assumption #2: REPLACED with accurate statement that cross-references exist and are in scope of FR-012; addresses CHK013, CHK014
- Added Assumption for ApiServerService retention with rationale; addresses CHK032
- Added Assumption for phase dependency ordering; addresses CHK031
- Noted Phase 10 as owner of npm package removal in Assumption about @modelcontextprotocol; addresses CHK029
- Added note that redux-persist rehydration behavior is relied upon; addresses CHK030

**tasks.md changes:**
- T039: Expanded scope from `pages/home/ or aiCore/` to all of `src/` (including `config/`, test files); addresses CHK028, /6.analyze H2
- T053 (NEW): Added Phase 6 verification task for US2 Acceptance Scenario 3 graceful route navigation; addresses CHK024, /6.analyze M1
