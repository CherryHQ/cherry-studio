# V2 Refactor Global TODO (Cross-Cutting)

This file tracks **cross-cutting, whole-refactor tasks only** in the v1→v2 migration: teardown of the v1 data stacks and UI libraries, migrator and schema finalization, removal-slated `@deprecated` sites, and release cleanup.
Per-module fine-grained TODOs live in their own docs and are not duplicated here.

> Counts are approximate values from a code scan and drift as development proceeds; verify before acting.
> Status legend: ✅ done ／ 🔲 todo ／ 🟡 in progress.

## Overview

| Category | Scale | Status |
| --- | --- | --- |
| Remove Redux | ~100 files / 28 slices | 🟡 partially migrated |
| Remove Dexie | ~50 files | 🟡 mostly migrated, fallback paths pending |
| Remove ElectronStore | ~10 files | 🔲 awaiting migration-window close |
| Remove antd | ~145 files | 🟡 settings/knowledge pages already clean |
| Remove styled-components | ~112 files | 🟡 in progress |
| Migrator finalization | 4 explicit todos | 🟡 14 migrators mostly complete |
| Schema / migration SQL regen | release gate | 🔲 before release |

## 1. Data-Layer Teardown

Remove all three v1 data stacks (Redux / Dexie / ElectronStore), replacing them with Cache / Preference / DataApi.

### Redux (~100 files, 28 slices)

- Entry points (delete last): `src/renderer/store/index.ts`, `src/renderer/store/migrate.ts`, and the Provider wrappers in each `src/renderer/windows/*/App.tsx`.
- The main-process bridge `ReduxService` is already stubbed (`@deprecated`, every call logs `logger.error` and returns empty values); call sites in the renderer still using it must move to the new data layer.
- Migrate by area in batches (granularity reference, not per-file):

| Batch | Scope | Status | Blocker / Next direction |
| --- | --- | --- | --- |
| settings slice | settings-page reads/writes, ~18 files | 🟡 partial | Replace `useAppSelector(state.settings.*)` with `usePreference` |
| chat / message UI state | ~18 files | 🟡 persistence already on DataApi | Move ephemeral UI state (selection/editing/reply) to Context or a hook |
| llm / provider / assistant | ~14 files | 🔲 not migrated | Needs a renderer-side provider/assistant data channel (DataApi or IPC) |
| knowledge / note | ~8 files | 🔲 not migrated | Needs knowledge DataApi endpoints |
| mcp / integrations | ~7 files | 🔲 not migrated | Move MCP state to DataApi or IPC |
| runtime / UI ephemera | ~14 files | 🟡 mixed | Move pure UI state to Context / local state, no persistence layer needed (lowest risk, can go first) |

Representative entry slices: `src/renderer/store/{settings,llm,assistants,knowledge,mcp,runtime}.ts`.

### Dexie (~50 files)

- Entry points (delete last): `src/renderer/databases/index.ts`, `src/renderer/databases/upgrades.ts`.
- Messages / files / knowledge / translate are mostly migrated to SQLite; remaining Dexie reads are mostly fallbacks, and `src/renderer/services/db/DexieMessageDataSource.ts` is a fallback pending removal.
- Migration-only readers (`DexieFileReader` / `DexieSettingsReader`) are used by the v1→v2 migration flow; keep them until the migration window closes, then delete (see §6).

### ElectronStore (~10 files)

- Entry point (delete last): `src/main/services/ConfigManager.ts` (`@deprecated Scheduled for removal in v2.0.0`, `new Store()`).
- Boot config is already migrated to v2 by `BootConfigMigrator`; delete `ConfigManager` once main-process config reads move to v2 preference.
- `PreferencesMigrator` reads legacy electron-store keys via the readers; this is migration-only (see §6).

## 2. UI-Layer Teardown

Migrate the prohibited libraries antd / styled-components fully to `@cherrystudio/ui` (Tailwind + Shadcn).
HeroUI is already removed (0 imports); `@cherrystudio/ui` is adopted in ~400 files, and settings / knowledge / library / code / notes / mini-apps pages are essentially clean.

- antd and styled-components overlap heavily (~21 files import both); prioritizing the overlapping files clears two items at once.
- Migrate by area in batches:

| Area | antd | styled | Priority | Notes |
| --- | --- | --- | --- | --- |
| home (main chat UI) | ~80 | ~58 | high | core UX: Messages / Inputbar / Blocks |
| shared Popups | ~4 | ~4 | high | AddAssistantPopup / AgentModal / SelectModelPopup; high-traffic shared, migrating them cascades unblocks |
| agents | ~22 | ~6 | medium | can batch with home |
| paintings (per-provider config pages) | ~13 | ~11 | medium | all are antd+styled overlap, good consolidation target |
| windows | ~10 | ~16 | medium | quickAssistant / selection / migrationV2 / trace |
| history / files / launchpad | ~5 | ~8 | low | lightweight |
| single-file holdouts | 3 | — | low | SkillsSettings, ModelSelectorLegacy, ProviderLogoPicker |

- Special case: `src/renderer/components/MarkdownShadowDomRenderer.tsx` uses styled-components to inject Shadow DOM CSS and needs dedicated handling.

## 3. Migrator Finalization

The 14 migrators are mostly complete; only the following have explicit unfinished work:

| Item | Location | TODO |
| --- | --- | --- |
| ChatMigrator i18n | `ChatMigrator.ts:761` | `// TODO: i18n`; fallback topic name is hardcoded English `Unnamed Topic`, needs an i18n key |
| KnowledgeVectorMigrator failure handling | `KnowledgeVectorMigrator.ts` | Base-level execution failures are treated as whole-migration failures (README marks IMPORTANT); confirm the design or implement a skippable-base mode |
| TranslateMigrator missing test | `migrators/__tests__/` | The only migrator without a matching test; add `TranslateMigrator.test.ts` |
| V1_REQUIRED_VERSION lock-in | `versionPolicy.ts:34` | TODO: update once the final v1 version is determined (currently `1.9.0`, expected ~1.9.x) |

Documented intentional skips (must be called out in release notes):

- Knowledge: `video` / `memory` items not migrated; directory children not rebuilt; legacy sitemap items migrate as URL items; grouping metadata lost (`groupId = null`).
- KnowledgeVector: the v1 legacy vector DBs are left untouched in place; after a successful migration they remain on disk as orphans (no cleanup trigger currently — a future user-confirmed cleanup would reclaim the disk).
- Note: `activeFilePath` / `activeNodeId` not migrated, re-established at runtime.
- MCP: provider cache not migrated, re-fetched at runtime.

## 4. Schema / Migration SQL Finalization

- `migrations/sqlite-drizzle/` is already a single `0000_loud_sugar_man.sql` (+ `meta/`).
- Before release, regenerate a single clean initial migration from the final schemas to clear intermediate dev state (already mandated in CLAUDE.md).
- Note `drizzle-kit generate` still exits 0 on a forked chain; only `pnpm db:migrations:check` flags it. Mid-development schema drift is acceptable — do not author patch migrations.

## 5. In-Code @deprecated Markers

~78 occurrences / 58 files, of which ~39 explicitly say `Scheduled for removal in v2.0.0`. Removal-slated call sites grouped by subsystem:

| Group | Scope | Replacement direction |
| --- | --- | --- |
| Redux store slices | 29 files (`store/*`) | DataApi + Preference + SQLite |
| Dexie / message data sources | 4 files (`databases/`, `DexieMessageDataSource`, `DbService`) | DataApi (main chat) / AgentMessageDataSource (agent sessions) |
| Redux-coupled hooks / main bridge | 6 files (`useStore` / `useSettings` / `useTagsLegacy`, `ReduxService`, etc.) | `usePreference` / `useTags`(v2); `ReduxService` already stubbed |
| Shared data types | agent / message / provider types (pagination response, citation format, legacy provider flags) | `OffsetPaginationResponse`, `MainTextBlock.references`, etc. |
| Protocol / message format | `LanFile*` JSON format, web-search accessors | binary frame, `CitationMessageBlock` |
| Component / service redesign | `CodeEditor`→`@cherrystudio/ui`, `FileManager` (do not extend), `deleteMessageFiles`→`safeDeleteFiles`, etc. | see each annotation |

Migration-relevant TODO/FIXME (~53 filtered from ~157; the rest are ordinary code notes) — main workstreams:

- Preference / Provider settings migration (largest, ~18, incl. `ProviderSettings/utils/v1ProviderShim.ts` "delete after Phase 5").
- Service architecture / lifecycle refactor (~10).
- Redux → SQLite/Drizzle (~9, concentrated in `apiServer/routes/knowledge/handlers.ts`).
- Phase-2 file-service stubs (~8).
- Message-type migration (~5), IPC handler cleanup (~6), DataApi integration (~3).

## 6. Release & Cleanup

- Delete migration-only code: `DexieFileReader`, `DexieSettingsReader`, the electron-store read paths, etc. are used only by the v1→v2 migration flow; remove after the migration window closes (the lowest supported v1 version stops upgrading).
- Aggregate breaking changes: before release the release manager aggregates `docs/breaking-changes/` and translates them into the Chinese user-facing release note (see that directory's README).
- Delete the entire `v2-refactor-temp/` directory: confirm the tooling is no longer needed, move any docs worth keeping to their canonical locations, delete the directory, and clean up `.gitignore` references (see the Cleanup plan in this directory's README).
