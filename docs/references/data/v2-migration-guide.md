# Migration V2 (Main Process)

Architecture for the new one-shot migration from the legacy Dexie + Redux Persist stores into the SQLite schema. This module owns orchestration, data access helpers, migrator plugins, and IPC entry points used by the renderer migration window.

## Version Upgrade Requirements

The v2 migration system enforces a **linear upgrade path** to ensure
data integrity:

```
v1.old  →  v1.last (≥1.9.0)  →  v2.0.0  →  v2.x
```

### Why a linear path?

v2.0.0 contains the one-shot data migration from Redux/Dexie to SQLite.
Supporting migration from every v1 version would create an O(n²) test
matrix. By requiring all users to be on the final v1 release first, the
migration code only needs to handle a single source data format.

### How it works

1. **VersionService** has been embedded since v1.7. It writes a
   `version.log` file to `{userData}/` on every launch where the
   version changes.
2. On v2 first launch, `v2MigrationGate.ts` reads `version.log` via
   `MigrationPaths.versionLogFile` (using the resolved userData path
   that accounts for v1 custom directories).
3. If the previous version is too old, missing, or if the user skipped
   v2.0.0, the gate shows an error dialog and quits.

### Blocking rules

| Scenario | Block reason | User action |
|----------|-------------|-------------|
| No `version.log` (v1 < 1.7 user) | `no_version_log` | Install v1.last, run once, then install v2.0.0 |
| Previous version < 1.9.0 | `v1_too_old` | Upgrade to v1.last first |
| Previous version is v1.x but current > v2.0.0 | `v2_gateway_skipped` | Install v2.0.0 first |

### Pre-release versions

v2.0.0 pre-releases (alpha/beta/rc) are treated as **before v2.0.0**
per semver ordering. They are allowed as migration targets from v1.last
(the gateway check coerces `currentVersion`, so `2.0.0-alpha` → `2.0.0`
passes). Pre-release to pre-release upgrades work because migration
status is `completed` after the first successful run.

The gateway is **strictly v2.0.0** — v2.0.x patches are blocked from
being a first migration target. This may be relaxed in a future release.

### Relationship with the auto-updater

The auto-updater (`AppUpdaterService`) controls which versions are
offered via OTA using `minCompatibleVersion` in the remote config. The
migration gate is a **separate safety net** for users who manually
download and install a version. Both systems enforce compatible upgrade
paths but operate independently.

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
- `core/MigrationPaths.ts` defines `MigrationPaths` (a frozen object of pre-computed paths) and `resolveMigrationPaths()` which detects v1 legacy userData directories from `~/.cherrystudio/config/config.json`. Called once at the migration gate entry, before engine initialization. All migration code uses these paths instead of `app.getPath()` — see the **Path safety** convention below.
- `core/MigrationContext.ts` builds the shared context passed to every migrator:
  - `sources`: `ConfigManager` (ElectronStore), `ReduxStateReader` (parsed Redux Persist data), `DexieFileReader` (JSON exports), `LegacyHomeConfigReader` (v1 `~/.cherrystudio/config/config.json` for the config-file migration path used by `BootConfigMigrator`)
  - `db`: current SQLite connection
  - `paths`: `MigrationPaths` — pre-computed filesystem paths; migrators that need file paths use `ctx.paths` instead of `app.getPath()`
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
- Current migrators (see `migrators/README-<name>.md` for detailed documentation):
  - `PreferencesMigrator` (implemented): maps ElectronStore + Redux settings to the `preference` table using `mappings/PreferencesMappings.ts`.
  - `ChatMigrator` (implemented): migrates topics and messages from Dexie to SQLite. See [`README-ChatMigrator.md`](../../../src/main/data/migration/v2/migrators/README-ChatMigrator.md).
  - `BootConfigMigrator` (implemented, file-target): migrates early-boot settings into the file-based `bootConfigService` (`~/.cherrystudio/boot-config.json`) rather than a SQLite table. Reads from Redux (`disableHardwareAcceleration`) and from the v1 home config file (`~/.cherrystudio/config/config.json`'s `appDataPath` → `app.user_data_path`) via a `'configfile'` source kind. See [`README-BootConfigMigrator.md`](../../../src/main/data/migration/v2/migrators/README-BootConfigMigrator.md).
  - `AssistantMigrator`, `KnowledgeMigrator` (placeholders): scaffolding and TODO notes for future tables.
- Conventions:
  - All logging goes through `loggerService` with a migrator-specific context.
  - Use `MigrationContext.sources` instead of accessing raw files/stores directly.
  - Use `sharedData` to pass IDs or lookup tables between migrators (e.g., assistant -> chat references) instead of re-reading sources.
  - Stream large Dexie exports (`JSONStreamReader`) and batch inserts to avoid memory spikes.
  - **Foreign keys during bulk inserts**: libsql (turso's SQLite fork) is compiled with `SQLITE_DEFAULT_FOREIGN_KEYS=1`, so every new connection has `foreign_keys = ON` by default (unlike standard SQLite). Additionally, `@libsql/client`'s `transaction()` nullifies its internal connection after each transaction (`this.#db = null`), and the lazily-created replacement inherits the compile-time default (FK ON). If your migrator does batch inserts into tables with self-referencing FKs (e.g., `message.parentId → message.id`), you **must** run `await db.run(sql\`PRAGMA foreign_keys = OFF\`)` before **each** `db.transaction()` call — setting it once is not enough. The engine runs `PRAGMA foreign_key_check` after all migrators complete to verify referential integrity.
  - Count validation is mandatory; engine will fail the run if `targetCount < sourceCount - skippedCount` or if `ValidateResult.errors` is non-empty.
  - Keep migrations idempotent per run—engine clears target tables before it starts, but each migrator should tolerate retries within the same run.
  - **Path safety**: All filesystem paths MUST come from `ctx.paths` (the `MigrationPaths` object). NEVER call `app.getPath('userData')` or construct paths with `path.join` from scratch. Doing so bypasses the v1 legacy userData detection and may cause data loss for users with custom `appDataPath` configurations. If you need a path not yet in `MigrationPaths`, add it to the interface — do not inline it.

## Utilities

- `utils/ReduxStateReader.ts`: safe accessor for categorized Redux Persist data with dot-path lookup.
- `utils/DexieFileReader.ts`: reads exported Dexie JSON tables; can stream large tables.
- `utils/JSONStreamReader.ts`: streaming reader with batching, counting, and sampling helpers for very large arrays.
- `utils/LegacyHomeConfigReader.ts`: synchronously reads the v1 `~/.cherrystudio/config/config.json` file and normalizes its `appDataPath` field (both the legacy string shape and the current `{ executablePath, dataPath }[]` shape) into a `Record<executablePath, dataPath> | null`. Used exclusively by `BootConfigMigrator`'s `'configfile'` source.

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
- [ ] Include detailed comments for maintainability (file-level, function-level, logic blocks).
- [ ] **Create/update `migrators/README-<MigratorName>.md`** with detailed documentation including:
  - Data sources and target tables
  - Key transformations
  - Field mappings (source → target)
  - Dropped fields and rationale
  - Code quality notes
