# Database Layer

This directory contains database schemas and configuration.

## Documentation

- **Database Construction** (migrations, custom SQL, FTS5): [docs/references/data/database-construction.md](../../../../docs/references/data/database-construction.md)
- **Database Patterns** (schema authoring): [docs/references/data/database-patterns.md](../../../../docs/references/data/database-patterns.md)

## Directory Structure

```
src/main/data/db/
├── schemas/              # Drizzle table definitions
│   ├── _columnHelpers.ts # Reusable column definitions
│   ├── topic.ts          # Topic table
│   ├── message.ts        # Message table + MESSAGE_FTS_STATEMENTS (FTS5 vtable & triggers)
│   └── ...               # Other tables
├── seeding/              # Data seeding (see seeding/README.md)
├── restore/              # Backup-restore promotion primitives (see restore/README.md)
├── applyMigrations.ts    # Shared migration path (drizzle migrate + custom SQL replay)
├── customSqls.ts         # Custom SQL (triggers, virtual tables) — replayed every boot
└── DbService.ts          # Database connection management
```

## Quick Reference

### Naming Conventions

- **Table names**: Singular snake_case (`topic`, `message`, `app_state`)
- **Export names**: `xxxTable` pattern (`topicTable`, `messageTable`)
- **Inferred row types**: `XxxRow` (`$inferSelect`) / `InsertXxxRow` (`$inferInsert`) — e.g. `McpServerRow`, `InsertMcpServerRow`. The `Row` suffix keeps the DB-row type distinct from the API `XxxEntity`. See [naming-conventions.md §5.3](../../../../docs/references/naming-conventions.md#53-drizzle-schema-inferred-row-types)

### Common Commands

```bash
# Generate migrations after schema changes
pnpm db:migrations:generate
```

### Custom SQL (Triggers, Virtual Tables)

Drizzle cannot manage triggers and virtual tables. See `customSqls.ts` and [database-construction.md](../../../../docs/references/data/database-construction.md) for how these are handled.

### Column Helpers

```typescript
import { uuidPrimaryKey, createUpdateTimestamps } from './_columnHelpers'

export const myTable = sqliteTable('my_table', {
  id: uuidPrimaryKey(),
  name: text(),
  ...createUpdateTimestamps
})
```

### Error Translation

`sqliteErrors.ts` translates SQLite constraint violations raised by Drizzle
into `DataApiError` (UNIQUE → 409, FK → 404, CHECK / NOT NULL → 422). It
exposes three APIs:

- `classifySqliteError(e)` — walks the `.cause` chain and returns a
  discriminated union describing the violation (or `null` for non-constraint
  errors).
- `withSqliteErrors(op, handlers)` — runs `op` and routes any recognized
  violation through the matching handler; constraint kinds without a handler
  (and non-SQLite errors) are rethrown unchanged by construction.
- `defaultHandlersFor(resource, identifier)` — a complete set of sensible
  default handlers for the common CRUD case. Spread to override any specific
  kind.

Prefer `defaultHandlersFor` and spread-override only when you need a
different message or the opposite FK semantic (e.g. `invalidOperation` for
`ON DELETE RESTRICT` scenarios). The handlers are a **TOCTOU fallback, not a
replacement for application-level pre-validation** — see the file header for
the full discipline note.
