# Database Schema Guidelines

## Naming Conventions

- **Table names**: Use **singular** form with snake_case (e.g., `topic`, `message`, `app_state`)
- **Export names**: Use `xxxTable` pattern (e.g., `topicTable`, `messageTable`)
- **Column names**: Drizzle auto-infers from property names, no need to specify explicitly

## Column Helpers

All helpers are exported from `./schemas/columnHelpers.ts`.

### Primary Keys

| Helper | UUID Version | Use Case |
|--------|--------------|----------|
| `uuidPrimaryKey()` | v4 (random) | General purpose tables |
| `uuidPrimaryKeyOrdered()` | v7 (time-ordered) | Large tables with time-based queries |

**Usage:**

```typescript
import { uuidPrimaryKey, uuidPrimaryKeyOrdered } from './columnHelpers'

// General purpose table
export const topicTable = sqliteTable('topic', {
  id: uuidPrimaryKey(),
  name: text(),
  ...
})

// Large table with time-ordered data
export const messageTable = sqliteTable('message', {
  id: uuidPrimaryKeyOrdered(),
  content: text(),
  ...
})
```

**Behavior:**

- ID is auto-generated if not provided during insert
- Can be manually specified for migration scenarios
- Use `.returning()` to get the generated ID after insert

### Timestamps

| Helper | Fields | Use Case |
|--------|--------|----------|
| `createUpdateTimestamps` | `createdAt`, `updatedAt` | Tables without soft delete |
| `createUpdateDeleteTimestamps` | `createdAt`, `updatedAt`, `deletedAt` | Tables with soft delete |

**Usage:**

```typescript
import { createUpdateTimestamps, createUpdateDeleteTimestamps } from './columnHelpers'

// Without soft delete
export const tagTable = sqliteTable('tag', {
  id: uuidPrimaryKey(),
  name: text(),
  ...createUpdateTimestamps
})

// With soft delete
export const topicTable = sqliteTable('topic', {
  id: uuidPrimaryKey(),
  name: text(),
  ...createUpdateDeleteTimestamps
})
```

**Behavior:**

- `createdAt`: Auto-set to `Date.now()` on insert
- `updatedAt`: Auto-set on insert, auto-updated on update
- `deletedAt`: `null` by default, set to timestamp for soft delete

## JSON Fields

For JSON column support, use `{ mode: 'json' }`:

```typescript
data: text({ mode: 'json' }).$type<MyDataType>()
```

Drizzle handles JSON serialization/deserialization automatically.

## Foreign Keys

```typescript
// SET NULL: preserve record when referenced record is deleted
groupId: text().references(() => groupTable.id, { onDelete: 'set null' })

// CASCADE: delete record when referenced record is deleted
topicId: text().references(() => topicTable.id, { onDelete: 'cascade' })
```

## Migrations

Generate migrations after schema changes:

```bash
yarn db:migrations:generate
```
