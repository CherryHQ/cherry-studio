# Database Schema Guidelines

## Schema File Organization

### Principles

| Scenario                               | Approach            |
| -------------------------------------- | ------------------- |
| Strongly related tables in same domain | Merge into one file |
| Core tables / Complex business logic   | One file per table  |
| Tables that may cross multiple domains | One file per table  |

### Decision Criteria

**Merge when:**

- Tables have strong foreign key relationships (e.g., many-to-many)
- Tables belong to the same business domain
- Tables are unlikely to evolve independently

**Separate (one file per table) when:**

- Core table with many fields and complex logic
- Has a dedicated Service layer counterpart
- May expand independently in the future

### File Naming

- **Single-table files**: named after the table export name (`message.ts` for `messageTable`, `topic.ts` for `topicTable`)
- **Multi-table files**: lowercase, named by domain (`tagging.ts` for `tagTable` + `entityTagTable`)
- **Helper utilities**: underscore prefix (`_columnHelpers.ts`) to indicate non-table definitions

## Naming Conventions

- **Table names**: Use **singular** form with snake_case (e.g., `topic`, `message`, `app_state`)
- **Export names**: Use `xxxTable` pattern (e.g., `topicTable`, `messageTable`)
- **Column names**: Drizzle auto-infers from property names, no need to specify explicitly

## Column Helpers

All helpers are exported from `./schemas/_columnHelpers.ts`.

### Primary Keys

| Helper                    | UUID Version      | Use Case                             |
| ------------------------- | ----------------- | ------------------------------------ |
| `uuidPrimaryKey()`        | v4 (random)       | General purpose tables               |
| `uuidPrimaryKeyOrdered()` | v7 (time-ordered) | Large tables with time-based queries |

**Usage:**

```typescript
import { uuidPrimaryKey, uuidPrimaryKeyOrdered } from './_columnHelpers'

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

| Helper                         | Fields                                | Use Case                   |
| ------------------------------ | ------------------------------------- | -------------------------- |
| `createUpdateTimestamps`       | `createdAt`, `updatedAt`              | Tables without soft delete |
| `createUpdateDeleteTimestamps` | `createdAt`, `updatedAt`, `deletedAt` | Tables with soft delete    |

**Usage:**

```typescript
import {
  createUpdateTimestamps,
  createUpdateDeleteTimestamps,
} from "./_columnHelpers";

// Without soft delete
export const tagTable = sqliteTable("tag", {
  id: uuidPrimaryKey(),
  name: text(),
  ...createUpdateTimestamps,
});

// With soft delete
export const topicTable = sqliteTable("topic", {
  id: uuidPrimaryKey(),
  name: text(),
  ...createUpdateDeleteTimestamps,
});
```

**Behavior:**

- `createdAt`: Auto-set to `Date.now()` on insert
- `updatedAt`: Auto-set on insert, auto-updated on update
- `deletedAt`: `null` by default, set to timestamp for soft delete

## JSON Fields

For JSON column support, use `{ mode: 'json' }`:

```typescript
data: text({ mode: "json" }).$type<MyDataType>();
```

Drizzle handles JSON serialization/deserialization automatically.

## Foreign Keys

### Basic Usage

```typescript
// SET NULL: preserve record when referenced record is deleted
groupId: text().references(() => groupTable.id, { onDelete: "set null" });

// CASCADE: delete record when referenced record is deleted
topicId: text().references(() => topicTable.id, { onDelete: "cascade" });
```

### Self-Referencing Foreign Keys

For self-referencing foreign keys (e.g., tree structures with parentId), **always use the `foreignKey` operator** in the table's third parameter:

```typescript
import { foreignKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const messageTable = sqliteTable(
  "message",
  {
    id: uuidPrimaryKeyOrdered(),
    parentId: text(), // Do NOT use .references() here
    // ...other fields
  },
  (t) => [
    // Use foreignKey operator for self-referencing
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete(
      "set null"
    ),
  ]
);
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
export const topicTable = sqliteTable("topic", {
  id: uuidPrimaryKey(),
  // Application-managed reference (no FK constraint)
  // Validated by TopicService.setCurrentMessage()
  currentMessageId: text(),
});

export const messageTable = sqliteTable("message", {
  id: uuidPrimaryKeyOrdered(),
  // Database-enforced FK
  topicId: text().references(() => topicTable.id, { onDelete: "cascade" }),
});
```

**Why soft references for SQLite:**

- SQLite does not support `DEFERRABLE` constraints (unlike PostgreSQL/Oracle)
- Application-layer validation provides equivalent data integrity
- Simplifies insert/update operations without transaction ordering concerns

## Migrations

Generate migrations after schema changes:

```bash
pnpm agents:generate
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
const [row] = await db.insert(table).values(data).returning();
return rowToEntity(row);

// Avoid: Re-query after insert (unnecessary database round-trip)
await db.insert(table).values({ id, ...data });
return this.getById(id);
```

### Soft delete support

The schema supports soft delete via `deletedAt` field (see `createUpdateDeleteTimestamps`).
Business logic can choose to use soft delete or hard delete based on requirements.

## Raw SQL Queries & Recursive CTEs

Drizzle's `casing: 'snake_case'` only applies to the ORM channel
(`db.select()`, `db.insert()`, `db.update()`). Raw SQL via `db.all(sql\`...\`)`
returns SQLite's native snake_case columns with **no runtime mapping** — the
TypeScript generic on `db.all<T>()` is a compile-time assertion only. So
`db.all<typeof messageTable.$inferSelect>(sql\`SELECT * FROM message\`)` lies
to the type system: at runtime `row.parentId` is `undefined`; the actual key
is `parent_id`.

Recursive CTEs (`WITH RECURSIVE`) are the main reason raw SQL is needed —
Drizzle does not yet support them in the query builder.

### Pattern: CTE for IDs, ORM for rows

Keep raw SQL minimal. Use the CTE to compute the **set of IDs** you need
(single-word column, casing-safe), then fetch full rows through the ORM where
camelCase mapping is automatic and fully type-safe.

```typescript
// Step 1 — recursive CTE returns ID-only
const idRows = await db.all<{ id: string }>(sql`
  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id FROM message WHERE id = ${nodeId} AND deleted_at IS NULL
    UNION ALL
    SELECT m.id, m.parent_id FROM message m
    INNER JOIN ancestors a ON m.id = a.parent_id
    WHERE m.deleted_at IS NULL
  )
  SELECT id FROM ancestors
`)
const ids = idRows.map((r) => r.id)

// Step 2 — fetch full rows via ORM (auto camelCase)
const rows = ids.length > 0
  ? await db.select().from(messageTable).where(inArray(messageTable.id, ids))
  : []

// Step 3 — restore CTE order (IN-list does not preserve order)
const order = new Map(ids.map((id, i) => [id, i]))
rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
```

If the CTE computes a derived value (e.g. `tree_depth`), select it alongside
`id` — single-word aliases are also casing-safe — and join it back via a `Map`.

**Don't** `SELECT *` with raw SQL or write a snake→camel helper to patch the
output: both bypass Drizzle's type-safety and let future schema changes drift
silently.

Reference implementations: `MessageService.getTree` / `getBranchMessages` /
`getPathToNode`, `KnowledgeItemService.getCascadeIdsInBase`.

## Custom SQL

Drizzle cannot manage triggers and virtual tables (e.g., FTS5). These are defined in `customSql.ts` and run automatically after every migration.

**Why**: SQLite's `DROP TABLE` removes associated triggers. When Drizzle modifies a table schema, it drops and recreates the table, losing triggers in the process.

**Adding new custom SQL**: Define statements as `string[]` in the relevant schema file, then spread into `CUSTOM_SQL_STATEMENTS` in `customSql.ts`. All statements must use `IF NOT EXISTS` to be idempotent.

## Seeding

For initial data population (default preferences, builtin languages, preset providers), see [Database Seeding Guide](./database-seeding-guide.md).
