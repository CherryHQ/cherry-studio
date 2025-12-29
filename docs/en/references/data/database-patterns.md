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

### Basic Usage

```typescript
// SET NULL: preserve record when referenced record is deleted
groupId: text().references(() => groupTable.id, { onDelete: 'set null' })

// CASCADE: delete record when referenced record is deleted
topicId: text().references(() => topicTable.id, { onDelete: 'cascade' })
```

### Self-Referencing Foreign Keys

For self-referencing foreign keys (e.g., tree structures with parentId), **always use the `foreignKey` operator** in the table's third parameter:

```typescript
import { foreignKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const messageTable = sqliteTable(
  'message',
  {
    id: uuidPrimaryKeyOrdered(),
    parentId: text(),  // Do NOT use .references() here
    // ...other fields
  },
  (t) => [
    // Use foreignKey operator for self-referencing
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete('set null')
  ]
)
```

**Why this approach:**
- Avoids TypeScript circular reference issues (no need for `AnySQLiteColumn` type annotation)
- More explicit and readable
- Allows chaining `.onDelete()` / `.onUpdate()` actions

### Circular Foreign Key References

**Avoid circular foreign key references between tables.** For example:

```typescript
// ❌ BAD: Circular FK between tables
// tableA.currentItemId -> tableB.id
// tableB.ownerId -> tableA.id
```

If you encounter a scenario that seems to require circular references:

1. **Identify which relationship is "weaker"** - typically the one that can be null or is less critical for data integrity
2. **Remove the FK constraint from the weaker side** - let the application layer handle validation and consistency (this is known as "soft references" pattern)
3. **Document the application-layer constraint** in code comments

```typescript
// ✅ GOOD: Break the cycle by handling one side at application layer
export const topicTable = sqliteTable('topic', {
  id: uuidPrimaryKey(),
  // Application-managed reference (no FK constraint)
  // Validated by TopicService.setCurrentMessage()
  currentMessageId: text(),
})

export const messageTable = sqliteTable('message', {
  id: uuidPrimaryKeyOrdered(),
  // Database-enforced FK
  topicId: text().references(() => topicTable.id, { onDelete: 'cascade' }),
})
```

**Why soft references for SQLite:**
- SQLite does not support `DEFERRABLE` constraints (unlike PostgreSQL/Oracle)
- Application-layer validation provides equivalent data integrity
- Simplifies insert/update operations without transaction ordering concerns

## Migrations

Generate migrations after schema changes:

```bash
yarn db:migrations:generate
```

## Field Generation Rules

The schema uses Drizzle's auto-generation features. Follow these rules:

### Auto-generated fields (NEVER set manually)

- `id`: Uses `$defaultFn()` with UUID v4/v7, auto-generated on insert
- `createdAt`: Uses `$defaultFn()` with `Date.now()`, auto-generated on insert
- `updatedAt`: Uses `$defaultFn()` and `$onUpdateFn()`, auto-updated on every update

### Using `.returning()` pattern

Always use `.returning()` to get inserted/updated data instead of re-querying:

```typescript
// Good: Use returning()
const [row] = await db.insert(table).values(data).returning()
return rowToEntity(row)

// Avoid: Re-query after insert (unnecessary database round-trip)
await db.insert(table).values({ id, ...data })
return this.getById(id)
```

### Soft delete support

The schema supports soft delete via `deletedAt` field (see `createUpdateDeleteTimestamps`).
Business logic can choose to use soft delete or hard delete based on requirements.
