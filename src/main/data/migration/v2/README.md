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
