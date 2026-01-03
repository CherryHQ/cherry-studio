# Database Layer

This directory contains database schemas and configuration.

## Documentation

- **Database Patterns**: [docs/en/references/data/database-patterns.md](../../../../docs/en/references/data/database-patterns.md)

## Directory Structure

```
src/main/data/db/
├── schemas/              # Drizzle table definitions
│   ├── columnHelpers.ts  # Reusable column definitions
│   ├── topic.ts          # Topic table
│   ├── message.ts        # Message table
│   └── ...               # Other tables
├── seeding/              # Database initialization
└── DbService.ts          # Database connection management
```

## Quick Reference

### Naming Conventions

- **Table names**: Singular snake_case (`topic`, `message`, `app_state`)
- **Export names**: `xxxTable` pattern (`topicTable`, `messageTable`)

### Common Commands

```bash
# Generate migrations after schema changes
yarn db:migrations:generate
```

### Column Helpers

```typescript
import { uuidPrimaryKey, createUpdateTimestamps } from './columnHelpers'

export const myTable = sqliteTable('my_table', {
  id: uuidPrimaryKey(),
  name: text(),
  ...createUpdateTimestamps
})
```
