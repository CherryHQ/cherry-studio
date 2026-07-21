# Data Migration System

This directory contains the v2 data migration implementation.

## Documentation

- **Migration Guide**: [docs/references/data/v2-migration-guide.md](../../../../../docs/references/data/v2-migration-guide.md)

## Directory Structure

```
src/main/data/migration/v2/
├── core/              # MigrationEngine, MigrationContext, MigrationPaths
├── diagnostics/       # Failure support bundle builder and application-log collector
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

The diagnostic log collector is a separate domain: it reads the application's runtime logs, not
migration data. It resolves that directory through the central path registry with
`application.getPath('app.logs')`; this is not an exception permitting Electron `app.getPath()` in
migration code.

## Failure Diagnostic Bundle

Migration failures, blocked upgrade paths, and native preboot migration failures offer a support
bundle without changing the successful migration flow. Main owns the save dialog and writes the ZIP
atomically. Each bundle contains:

- `migration-diagnostics.json`: application version, platform, architecture, failure source/stage,
  a stable error summary, current progress, and migrator status. It deliberately avoids raw stack
  traces, paths, and business data that would duplicate the application logs.
- `README.txt`: bilingual privacy and manual-review guidance.
- Optional `logs/app.YYYY-MM-DD.log` and numeric rotation files such as
  `logs/app.YYYY-MM-DD.log.1`, each preserved as a separate ZIP entry.

"Today" means the user's local calendar date when they click save. The collector accepts only
regular application log files for that date; it excludes `app-error` logs, other dates, symlinks,
and directories. Included files retain their original bytes without redaction, parsing, or
truncation. If any eligible file cannot be collected, the entire log set is omitted while the basic
bundle is still saved.

The application never uploads, attaches, emails, or otherwise sends the bundle automatically; the
user must inspect it and attach it manually. A final compressed ZIP strictly larger than 15 MiB is
still saved and only triggers advice to use an email large-attachment or cloud-storage feature.

Renderer diagnostic commands carry no paths or file content. Main serializes save requests, waits
for an active save before quitting, remembers only the most recently saved bundle path, and owns the
fixed support address and prefilled `mailto:` URL. After saving, the user can open the email client,
reveal the ZIP in its folder, or copy the support address.

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

`AssistantMigrator` also owns v1 assistant tag-group migration: it inserts `group(entityType='assistant')` rows and assigns their IDs to `assistant.groupId` in the same transaction.

### Foreign Keys Caveat

The engine keeps `foreign_keys = OFF` for the **entire** migration: `MigrationDbService` sets the
pragma once after migrations run. better-sqlite3 keeps a single connection, so that pragma persists
for the whole migration with no per-transaction replay. **Migrators must NOT toggle FK
themselves.** Verify integrity with `this.assertOwnedForeignKeys(ctx.db, [...])` at the end of
`execute()` (own, fully-resolved tables only — exclude cross-domain-deferred and shared polymorphic
tables); the engine runs a final whole-database `foreign_key_check` as backstop. See the
[migration guide](../../../../../docs/references/data/v2-migration-guide.md) for details.
