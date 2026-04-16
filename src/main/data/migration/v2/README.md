# Data Migration System

This directory contains the v2 data migration implementation.

## Documentation

- **Migration Guide**: [docs/references/data/v2-migration-guide.md](../../../../../docs/references/data/v2-migration-guide.md)

## Directory Structure

```
src/main/data/migration/v2/
├── core/              # MigrationEngine, MigrationContext, MigrationPaths
├── migrators/         # Domain-specific migrators
│   └── mappings/      # Mapping definitions
├── utils/             # ReduxStateReader, DexieFileReader, JSONStreamReader, LegacyHomeConfigReader
├── window/            # IPC handlers, window manager
└── index.ts           # Public exports
```

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

**Required upgrade path**: `v1.old → v1.last (≥1.9.0) → v2.0.0 → v2.x`

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
3. Register in `migrators/index.ts`
4. Use `ctx.paths` for all filesystem paths — **NEVER** call `app.getPath()` directly

### Key Contracts

- `prepare(ctx)`: Dry-run checks, return counts
- `execute(ctx)`: Perform inserts, report progress
- `validate(ctx)`: Verify counts and integrity

### Foreign Keys Caveat

libsql defaults to `foreign_keys = ON` (compiled with `SQLITE_DEFAULT_FOREIGN_KEYS=1`).
`@libsql/client` creates new connections after each `transaction()`, resetting PRAGMAs.
For bulk inserts with self-referencing FKs, run `PRAGMA foreign_keys = OFF` before **each**
`db.transaction()` call. See the [migration guide](../../../../../docs/references/data/v2-migration-guide.md) for details.
