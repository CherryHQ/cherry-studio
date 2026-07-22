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
| `ctx.paths.dexieExportDir` | Renderer-provided export directory |
| `ctx.paths.localStorageExportFile` | Renderer-provided export file path |
| `ctx.paths.legacyConfigFile` | `path.join(os.homedir(), '.cherrystudio', 'config', 'config.json')` |
| `new Store({ cwd: ctx.paths.userData })` | `new Store()` |

`MigrationPaths` is resolved once at the migration gate entry by
`resolveMigrationPaths()` (including v1 legacy userData detection),
then passed through `MigrationContext.paths` to all migrators. If you
need a new path, add it to the `MigrationPaths` interface — do not
construct it inline.

Migration export paths follow the same rule. Renderer sends only a fixed logical target, an
allowlisted Dexie table name when applicable, and JSON data. Main resolves the destination from
`MigrationPaths`; the engine reads from and recursively cleans only `paths.migrationTempDir`.

The diagnostic log collector is a separate domain: it reads the application's runtime logs, not
migration data. It resolves that directory through the central path registry with
`application.getPath('app.logs')`; this is not an exception permitting Electron `app.getPath()` in
migration code.

## Failure Diagnostic Bundle

Migration failures, blocked upgrade paths, and native preboot migration failures offer a support
bundle without changing the successful migration flow. Main owns the save dialog and writes the ZIP
atomically. Each bundle contains:

- `migration-diagnostics.json`: application and process identity, migration run identity, failure
  source/stage/operation/target, version-gate inputs, current progress, migrator status, and the
  complete migration-boundary error when one exists (`name`, raw `message`, `stack`, nested
  `cause`, plus available `code`, `syscall`, and absolute `path`).
- Optional `logs/app.YYYY-MM-DD.log` and numeric rotation files such as
  `logs/app.YYYY-MM-DD.log.1`, each preserved as a separate ZIP entry.

"Today" means the user's local calendar date when they click save. The collector accepts only
application log names for that date; it excludes `app-error` logs and other dates. Every matching
path must resolve to a stable regular, non-symlink file. The collector opens and verifies every file,
keeps those handles through archive creation, and includes the complete same-day set without an
application-level file-count or raw-byte budget. Each handle streams only its scanned byte length.
If any path cannot be verified/opened, any stream fails, or a stream ends before its scanned length,
the whole log set is omitted and the builder atomically rebuilds a basic-only ZIP. The JSON records
completeness, included file sizes, failure reason, retry recommendation, relevant absolute path, and
the complete collection exception when one exists. `no_eligible_logs` records the reason and logs
directory without inventing an exception or stack.

The application never uploads, attaches, emails, or otherwise sends the bundle automatically; the
user must inspect it and attach it manually. A final compressed ZIP strictly larger than 15 MiB is
still saved and only triggers advice to use an email large-attachment or cloud-storage feature.

Renderer diagnostic commands carry no paths or file content. Main serializes save requests, gives
an active save an unbounded completion wait before quitting, and rejects migration-state changes
while a save or deferred quit is active. Main remembers only the most recently saved bundle path and
owns the fixed support address and prefilled `mailto:` URL. After saving, the user can open the email
client, reveal the ZIP in its folder, or copy the support address.

Native preboot saves install a scoped `before-quit` barrier before destination selection and remove
it after the save settles. An intercepted quit resumes through the native failure's existing Quit
decision instead of interrupting the save. This completion guarantee covers migration-flow actions
and cooperative Electron quit/close paths that can be intercepted. Forced process termination,
process crashes, and OS session termination that Electron cannot defer are outside the guarantee;
atomic publication still prevents those paths from exposing a partial destination archive.

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
