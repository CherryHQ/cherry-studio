# Data Migration System

This directory contains the v2 data migration implementation.

## Documentation

- **Migration Guide**: [docs/en/references/data/v2-migration-guide.md](../../../../../docs/en/references/data/v2-migration-guide.md)

## Directory Structure

```
src/main/data/migration/v2/
├── core/              # MigrationEngine, MigrationContext
├── migrators/         # Domain-specific migrators
│   └── mappings/      # Mapping definitions
├── utils/             # ReduxStateReader, DexieFileReader, JSONStreamReader
├── window/            # IPC handlers, window manager
└── index.ts           # Public exports
```

## Quick Reference

### Creating a New Migrator

1. Extend `BaseMigrator` in `migrators/`
2. Implement `prepare`, `execute`, `validate` methods
3. Register in `migrators/index.ts`

### Key Contracts

- `prepare(ctx)`: Dry-run checks, return counts
- `execute(ctx)`: Perform inserts, report progress
- `validate(ctx)`: Verify counts and integrity

### Foreign Keys Caveat

libsql defaults to `foreign_keys = ON` (compiled with `SQLITE_DEFAULT_FOREIGN_KEYS=1`).
`@libsql/client` creates new connections after each `transaction()`, resetting PRAGMAs.
For bulk inserts with self-referencing FKs, run `PRAGMA foreign_keys = OFF` before **each**
`db.transaction()` call. See the [migration guide](../../../../../docs/en/references/data/v2-migration-guide.md) for details.
