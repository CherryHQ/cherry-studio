# Data Migration System

This directory contains the v2 data migration implementation.

## Documentation

- **Migration Guide**: [docs/references/data/v2-migration-guide.md](../../../../../docs/references/data/v2-migration-guide.md)

## Directory Structure

```
src/main/data/migration/v2/
├── core/              # MigrationEngine, MigrationContext, MigrationPaths
├── diagnostics/       # Crash-safe state, strict bundle, and read-only database diagnostics
├── migrators/         # Domain-specific migrators
│   └── mappings/      # Mapping definitions
├── utils/             # ReduxStateReader, DexieFileReader, JSONStreamReader, LegacyHomeConfigReader
├── window/            # IPC handlers, window manager
└── index.ts           # Public exports
```

## Blocking-Failure Diagnostics

Migration diagnostics run before normal application bootstrap. `runV2MigrationGate()` constructs a
preboot-scoped `MigrationDiagnosticsCoordinator` before resolving paths and passes it explicitly to the engine,
window, and failure surfaces. It is deliberately not a lifecycle service or global singleton.

Only failures that stop migration are persisted. The owner closest to the failed boundary records one fixed
failure summary:

- the preboot gate owns path resolution, database initialization, version policy, and window startup;
- the renderer owns Redux/Dexie export read, parse, serialization, and handoff failures;
- each migrator owns source preparation, writes, invariants, and validation for its domain;
- the engine owns cross-migrator initialization/finalization and preserves evidence recorded by a throwing migrator;
- renderer process exit/unresponsive handling owns live process interruption evidence.

Recoverable row normalization and partially rejected optional records remain migration warnings. Diagnostic bundle
creation and database inspection are support operations: their failures must not replace the migration failure or
change whether migration may continue.

After paths resolve, the coordinator persists a bounded checkpoint at
`MigrationPaths.diagnosticsJournalFile` (`{userData}/migration-diagnostics-v2.json`).
It stores only the current attempt and the immediately previous failed/interrupted attempt. An attempt left unfinished
by force quit or power loss is closed as `process_interrupted` on the next launch. A live renderer crash is recorded
immediately before the native fallback is shown. Incompatible development checkpoints are discarded and replaced
without changing business data or migration eligibility. A successful migration reconciliation deletes the checkpoint
while retaining the completed in-memory summary for the current UI session.

The user-saved diagnostic ZIP has an exact two-file allowlist:

- `migration-diagnostics.json`
- `README.txt`

The sum of those entries is limited to 1 MiB **before compression**. The JSON document contains the current and
immediately previous attempt, failure-only payload-length facts, and bounded read-only database results. It excludes
application and migration logs, database/WAL/SHM files, the journal, exports, SQL, business rows, raw errors and
stacks, credentials, absolute paths, and user content.

Database inspection runs once in a short-lived child process against the database path, never against the live main
process connection. The parent accepts only the strict final result; timeout, crash, invalid output, or a child that
hangs after emitting partial output becomes a fixed `unavailable` result. The child is terminated, and the remaining
two-file bundle can still be saved.

For an actual blocking string or JSON write failure, the failed boundary may record at most three content-free UTF-8
byte lengths and whether the sample was truncated. Optional row failures and warning-only work do not produce this
evidence, and diagnostics never serialize the failed values themselves.

The same save operation is available from renderer migration errors, version-incompatibility blocks, pre-window
native failures, renderer crashes, renderer hangs that persist for 10 seconds, and unfinished-session recovery.
Completed migrations do not show diagnostic controls, including completions that contain warnings. While saving,
duplicate save and restart/close actions are disabled or deferred. After a successful save, the app can open the
user's external email client with instructions, reveal the ZIP, or copy the support address when the migration window
is available. It never uploads, sends, or attaches the bundle automatically; the user must review and attach the ZIP
manually.

The acceptance matrix is in
[`diagnostics/__tests__/MigrationDiagnosticAcceptance.integration.test.ts`](diagnostics/__tests__/MigrationDiagnosticAcceptance.integration.test.ts),
with shared seeded failures in
[`diagnostics/__tests__/fixtures/migrationDiagnosticAcceptanceFixtures.ts`](diagnostics/__tests__/fixtures/migrationDiagnosticAcceptanceFixtures.ts).
It builds and extracts real ZIPs, validates both allowlisted entries, checks the uncompressed budget and privacy
canaries, and covers archive finalization and database-process partial-output failures as support-chain cases.

## Path Safety — Use `MigrationPaths` (Strict Requirement)

> **⚠️ WARNING: Not using predefined paths may cause user data loss.**
>
> v1 users may have configured a custom userData directory via
> `~/.cherrystudio/config/config.json`. If migration code calls
> `app.getPath('userData')` or `new Store()` directly, on the first v2
> launch it will read from the Electron default path instead of the
> user's actual data directory — causing migration to be silently
> skipped or to migrate empty data, **making user data appear lost**.

All migration code **MUST** use the pre-computed path constants from
`MigrationPaths`. **NEVER** call `app.getPath()` directly or construct
paths with `path.join()` from scratch inside migration code.

| Correct ✅ | Wrong ❌ |
|-----------|---------|
| `ctx.paths.userData` | `app.getPath('userData')` |
| `ctx.paths.databaseFile` | `path.join(app.getPath('userData'), 'cherrystudio.sqlite')` |
| `ctx.paths.knowledgeBaseDir` | `path.join(app.getPath('userData'), 'Data', 'KnowledgeBase')` |
| `ctx.paths.legacyConfigFile` | `path.join(os.homedir(), '.cherrystudio', 'config', 'config.json')` |
| `new Store({ cwd: ctx.paths.userData })` | `new Store()` |

`MigrationPaths` is resolved once at the migration gate entry by
`resolveMigrationPaths()` (including v1 legacy userData detection),
then passed through `MigrationContext.paths` to all migrators. If you
need a new path, add it to the `MigrationPaths` interface — do not
construct it inline.

## Version Compatibility Gate

Before the migration window is created, the gate validates the upgrade
path using `core/versionPolicy.ts`. This catches manual installs that
bypass the auto-updater's version filtering.

**Required upgrade path**: `v1.old → v1.last (≥1.9.12) → v2.0.0 → v2.x`

### Blocking rules

| Rule | Condition | Reason |
|------|-----------|--------|
| no_version_log | Legacy data exists but `version.log` is missing | User never ran a v1 version with VersionService (embedded since v1.7) |
| v1_too_old | `previousVersion < V1_REQUIRED_VERSION` | Data not in final v1 form |
| v2_gateway_skipped | `previousVersion < 2.0.0 && coerce(currentVersion) > 2.0.0` | Skipped the v2.0.0 migration gateway |

### Pre-release versions

v2.0.0 pre-releases (alpha/beta/rc) are treated as **before v2.0.0**
in semver ordering. This means:
- v1.last → v2.0.0-alpha is allowed (the gateway check uses coerced
  currentVersion, so `gt('2.0.0', '2.0.0')` is false)
- Pre-release → pre-release upgrades work because migration status is
  already `completed` after the first successful run
- v2.0.0 is strictly required as the gateway — v2.0.x patches are
  blocked until the policy is updated in a future release

### Path safety for version.log

The version check reads `paths.versionLogFile` (resolved by
`MigrationPaths`), NOT `VersionService`'s cached path. This is
critical for v1 users with custom userData directories — see the
Path Safety section above.

## Quick Reference

### Creating a New Migrator

1. Extend `BaseMigrator` in `migrators/`
2. Implement `prepare`, `execute`, `validate` methods
3. Add it to the `getAllMigrators()` list in `migrators/migratorRegistry.ts`
4. Use `ctx.paths` for all filesystem paths — **NEVER** call `app.getPath()` directly

### Key Contracts

- `prepare(ctx)`: Dry-run checks, return counts
- `execute(ctx)`: Perform inserts, report progress
- `validate(ctx)`: Verify counts and integrity

### Foreign Keys Caveat

The engine keeps `foreign_keys = OFF` for the **entire** migration: `MigrationDbService` sets the
pragma once after migrations run. better-sqlite3 keeps a single connection, so that pragma persists
for the whole migration with no per-transaction replay. **Migrators must NOT toggle FK
themselves.** Verify integrity with `this.assertOwnedForeignKeys(ctx.db, [...])` at the end of
`execute()` (own, fully-resolved tables only — exclude cross-domain-deferred and shared polymorphic
tables); the engine runs a final whole-database `foreign_key_check` as backstop. See the
[migration guide](../../../../../docs/references/data/v2-migration-guide.md) for details.
