# Migration V2 (Main Process)

Architecture for the new one-shot migration from the legacy Dexie + Redux Persist stores into the SQLite schema. This module owns orchestration, data access helpers, migrator plugins, and IPC entry points used by the renderer migration window.

## Directory Layout

```
src/main/data/migration/v2/
├── core/              # Engine + shared context
├── migrators/         # Domain-specific migrators and mappings
├── utils/             # Data source readers (Redux, Dexie, streaming JSON)
├── window/            # IPC handlers + migration window manager
└── index.ts           # Public exports for main process
```

## Core Contracts

- `core/MigrationEngine.ts` coordinates all migrators in order, surfaces progress to the UI, and marks status in `app_state.key = 'migration_v2_status'`. It will clear new-schema tables before running and abort on any validation failure.
- `core/MigrationContext.ts` builds the shared context passed to every migrator:
  - `sources`: `ConfigManager` (ElectronStore), `ReduxStateReader` (parsed Redux Persist data), `DexieFileReader` (JSON exports)
  - `db`: current SQLite connection
  - `sharedData`: `Map` for passing cross-cutting info between migrators
  - `logger`: `loggerService` scoped to migration
- `@shared/data/migration/v2/types` defines stages, results, and validation stats used across main and renderer.

## Migrators

- Base contract: extend `migrators/BaseMigrator.ts` and implement:
  - `id`, `name`, `description`, `order` (lower runs first)
  - `prepare(ctx)`: dry-run checks, counts, and staging data; return `PrepareResult`
  - `execute(ctx)`: perform inserts/updates; manage your own transactions; report progress via `reportProgress`
  - `validate(ctx)`: verify counts and integrity; return `ValidateResult` with stats (`sourceCount`, `targetCount`, `skippedCount`) and any `errors`
- Registration: list migrators (in order) in `migrators/index.ts` so the engine can sort and run them.
- Current migrators:
  - `PreferencesMigrator` (implemented): maps ElectronStore + Redux settings to the `preference` table using `mappings/PreferencesMappings.ts`.
  - `AssistantMigrator`, `KnowledgeMigrator`, `ChatMigrator` (placeholders): scaffolding and TODO notes for future tables.
- Conventions:
  - All logging goes through `loggerService` with a migrator-specific context.
  - Use `MigrationContext.sources` instead of accessing raw files/stores directly.
  - Use `sharedData` to pass IDs or lookup tables between migrators (e.g., assistant -> chat references) instead of re-reading sources.
  - Stream large Dexie exports (`JSONStreamReader`) and batch inserts to avoid memory spikes.
  - Count validation is mandatory; engine will fail the run if `targetCount < sourceCount - skippedCount` or if `ValidateResult.errors` is non-empty.
  - Keep migrations idempotent per run—engine clears target tables before it starts, but each migrator should tolerate retries within the same run.

## Utilities

- `utils/ReduxStateReader.ts`: safe accessor for categorized Redux Persist data with dot-path lookup.
- `utils/DexieFileReader.ts`: reads exported Dexie JSON tables; can stream large tables.
- `utils/JSONStreamReader.ts`: streaming reader with batching, counting, and sampling helpers for very large arrays.

## Window & IPC Integration

- `window/MigrationIpcHandler.ts` exposes IPC channels for the migration UI:
  - Receives Redux data and Dexie export path, starts the engine, and streams progress back to renderer.
  - Manages backup flow (dialogs via `BackupManager`) and retry/cancel/restart actions.
- `window/MigrationWindowManager.ts` creates the frameless migration window, handles lifecycle, and relaunch instructions after completion in production.

## Implementation Checklist for New Migrators

- [ ] Add mapping definitions (if needed) under `migrators/mappings/`.
- [ ] Implement `prepare/execute/validate` with explicit counts, batch inserts, and integrity checks.
- [ ] Wire progress updates through `reportProgress` so UI shows per-migrator progress.
- [ ] Register the migrator in `migrators/index.ts` with the correct `order`.
- [ ] Add any new target tables to `MigrationEngine.verifyAndClearNewTables` once those tables exist.
