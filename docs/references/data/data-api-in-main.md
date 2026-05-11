# DataApi in Main Process

This guide covers how to implement API handlers and services in the Main process.

## Architecture Layers

```
Handlers → Services → Database
```

- **Handlers**: Thin layer, extract params, call service, transform response
- **Services**: Business logic, validation, transaction coordination, data access via Drizzle ORM
- **Database**: Drizzle ORM + SQLite

## Transport Adapters

ApiServer is transport-agnostic. Adapters in `api/core/adapters/` bridge specific transports (IPC, HTTP) to ApiServer. Each adapter implements `Disposable` for automatic lifecycle cleanup. See `IpcAdapter.ts` JSDoc for design rationale and extension guide.

## Implementing Handlers

### Location
`src/main/data/api/handlers/`

### Handler Responsibilities
- Extract parameters from request
- Delegate to business service
- Transform response for IPC
- **NO business logic here**

### Handler Type Annotation

Every per-module handler record **MUST** be annotated with `HandlersFor<XxxSchemas>`. This is the canonical shape for all files in `src/main/data/api/handlers/` — not a convention to choose among alternatives.

`HandlersFor<XxxSchemas>` enforces two invariants:

- **Paths are narrowed to the module's own schema.** Path strings outside `XxxSchemas` (typos, cross-module leaks) produce a compile error.
- **Methods are exhaustive.** Every `path + method` declared in `XxxSchemas` must have a handler; adding an endpoint to the schema without a matching handler is a compile error.

### Example Handler

```typescript
// handlers/topics.ts
import { topicService } from '@data/services/TopicService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { TopicSchemas } from '@shared/data/api/schemas/topics'

export const topicHandlers: HandlersFor<TopicSchemas> = {
  '/topics': {
    GET: async ({ query }) => {
      const { page = 1, limit = 20 } = query ?? {}
      return await topicService.list({ page, limit })
    },
    POST: async ({ body }) => {
      return await topicService.create(body)
    }
  },
  '/topics/:id': {
    GET: async ({ params }) => {
      return await topicService.getById(params.id)
    },
    PUT: async ({ params, body }) => {
      return await topicService.replace(params.id, body)
    },
    PATCH: async ({ params, body }) => {
      return await topicService.update(params.id, body)
    },
    DELETE: async ({ params }) => {
      await topicService.delete(params.id)
    }
  }
}
```

### Register Handlers

```typescript
// handlers/index.ts
import { topicHandlers } from './topic'
import { messageHandlers } from './message'

export const allHandlers: ApiImplementation = {
  ...topicHandlers,
  ...messageHandlers
}
```

## Implementing Services

### Location
`src/main/data/services/`

### Service Responsibilities
- Business validation
- Transaction coordination
- Domain workflows
- Data access via Drizzle ORM

### Cross-Service Table Access

Each table has exactly **one owning service** — the rule is split by access kind:

- **Writes (`insert` / `update` / `delete`) to a table you do not own: forbidden.** Call the owner's method (pass `tx` for transactional writes — owners' mutation methods accept `Pick<DbType, 'delete' | 'insert' | ...>` as the first arg). If a needed shape is missing, add a method on the owner; bulk needs get a bulk method (e.g. `purgeForEntitiesTx`).
- **Reads from a table you do not own: allowed when inlining is the simpler path.** A cross-table JOIN that combines the owner's table into your query in one round-trip is fine; reach for the owner's read API only when the read needs business logic the owner already encapsulates.

Why writes are strict: the owning service is the single source of truth for the table's invariants (unique indices, `orderKey` semantics, soft-delete, audit timestamps) and emits its mutation logs. Foreign writes split that knowledge across every caller and silence the log narrative.

✅ `ProviderService.delete` → `pinService.purgeForEntitiesTx(tx, 'model', ids)`
✅ `AssistantService.list` JOINs `entity_tag` + `tag` inline to load tags per assistant
❌ `ProviderService.delete` → `tx.delete(pinTable).where(...)` directly

If you're tempted to write "going through `XxxService` would be over-engineering" — stop. A 5-line method on the owner is not over-engineering; a foreign service writing to its table is.

### Example Service

```typescript
// services/TopicService.ts
import { eq, desc, sql } from 'drizzle-orm'
import { application } from '@application'
import { topicTable } from '@data/db/schemas/topic'
import { DataApiErrorFactory } from '@shared/data/api'

export class TopicService {
  private static instance: TopicService

  static getInstance(): TopicService {
    if (!this.instance) {
      this.instance = new TopicService()
    }
    return this.instance
  }

  private get db() {
    return application.get('DbService').getDb()
  }

  async list(options: { page: number; limit: number }) {
    const { page, limit } = options
    const offset = (page - 1) * limit

    const [items, countResult] = await Promise.all([
      this.db.select().from(topicTable)
        .orderBy(desc(topicTable.updatedAt))
        .limit(limit).offset(offset),
      this.db.select({ count: sql<number>`count(*)` }).from(topicTable)
    ])

    return { items, total: countResult[0].count, page, limit }
  }

  async getById(id: string) {
    const [topic] = await this.db.select().from(topicTable)
      .where(eq(topicTable.id, id)).limit(1)
    if (!topic) {
      throw DataApiErrorFactory.notFound('Topic', id)
    }
    return topic
  }

  async create(data: CreateTopicDto) {
    this.validateTopicData(data)
    const [topic] = await this.db.insert(topicTable).values(data).returning()
    return topic
  }

  async update(id: string, data: Partial<UpdateTopicDto>) {
    await this.getById(id) // Throws if not found
    const [topic] = await this.db.update(topicTable)
      .set(data).where(eq(topicTable.id, id)).returning()
    return topic
  }

  async delete(id: string) {
    await this.getById(id) // Throws if not found
    await this.db.delete(topicTable).where(eq(topicTable.id, id))
  }

  private validateTopicData(data: CreateTopicDto) {
    if (!data.name?.trim()) {
      throw DataApiErrorFactory.validation({ name: ['Name is required'] })
    }
  }
}

export const topicService = TopicService.getInstance()
```

### Write-path defaults

`service.create()` passes a value into `db.insert(...).values({...})` **only** for columns that are `NOT NULL`, have neither a DB `DEFAULT` nor a `$defaultFn`, and are not already supplied by the DTO:

```ts
async create(dto: CreateXxxDto) {
  return await this.db.insert(xxxTable).values({
    ...dto,
    settings: dto.settings ?? DEFAULT_XXX_SETTINGS  // service-owned default for a tunable product value
  }).returning()
}
```

For everything else — fields with DB DEFAULTs, `$defaultFn` columns, or genuinely nullable columns — **omit the field from `values({...})`**. Drizzle leaves it out of the SQL; the DB applies its own default (or NULL for nullable columns). Restating the DB's knowledge in app code creates drift risk when defaults later change.

For the cross-layer placement decision tree, see [Default Values & Nullability](./best-practice-default-values-and-nullability.md).

### Row → Entity Mapping

Each Entity Service provides a `rowToEntity` function that bridges a Drizzle row to its domain entity. Use `nullsToUndefined` (from `services/utils/rowMappers.ts`) for the SQLite NULL → TypeScript `undefined` translation.

**Standard skeleton:**

```ts
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

function rowToMCPServer(row: typeof mcpServerTable.$inferSelect): MCPServer {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    type: clean.type as MCPServer['type'], // narrow enum
    installSource: clean.installSource as MCPServer['installSource'],
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}
```

Audit columns generated by `createUpdateTimestamps` are DB-level `.notNull()`, so `row.createdAt` / `row.updatedAt` narrow to `number` and `timestampToISO` is the default. `timestampToISOOrUndefined` is reserved for construction paths where the entire source row may be absent (e.g. `MiniAppService.builtinToMiniApp` merging a builtin definition with an optional `dbRow`).

**Advanced skeleton — preserving `T | null` fields:**

When the domain type declares a field as `T | null` (e.g. `KnowledgeBaseSchema.embeddingModelId: z.string().nullable()`), bypass `clean` for that field and reference `row` directly. `nullsToUndefined` narrows all top-level `null`s to `undefined` and would break the `T | null` contract if the field came from `clean`.

```ts
function rowToKnowledgeBase(row: typeof knowledgeBaseTable.$inferSelect): KnowledgeBase {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    // Preserve `string | null` contract — bypass clean (which would narrow null → undefined)
    embeddingModelId: row.embeddingModelId,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}
```

Rule of thumb: **domain field typed `T | null` → use `row.x`; domain field typed `T?` or `T` → use `clean.x` (or `...clean`).**

**When `nullsToUndefined + spread` is NOT a fit:**

Some `rowToEntity` functions do too much to benefit from spread. Keep them hand-written when any of the following apply:

- **Field renaming**: `row.parameters → domain parameterSupport` (ModelService)
- **Computed / merged fields**: `authType` derivation, `apiFeatures` merging from defaults (ProviderService)
- **Sensitive data sanitization**: `apiKeys` stripping — `...clean` would leak unsanitized values

**Anti-pattern — `??` fallbacks for fabricated defaults:**

`row.x ?? '🌟'` / `row.x ?? []` inside `rowToEntity` is **forbidden**. The presence of such a fallback is reverse evidence that the column should be `NOT NULL` with a DB DEFAULT or `$defaultFn` — see [Default Values & Nullability § R3](./best-practice-default-values-and-nullability.md). The legitimate exception is when the entity field is genuinely `T | null` (e.g. `assistant.modelId`); then bypass `clean` and reference `row.x` directly to preserve the NULL contract — that is the **Advanced skeleton** above, not a `??` fallback.

**Conventions:**

1. **DB NULL ↔ domain `undefined` boundary.** Domain types under `@shared/data/types/*` use optional fields (`?:`) rather than `T | null`, aligning with the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) and keeping `null` from leaking to the renderer via IPC. `nullsToUndefined(row)` is the only place this translation happens.
2. **Batch vs single-field null handling.** For processing an entire row, always use `nullsToUndefined(row)` + spread — do NOT hand-write per-field `?? undefined`. For single values that are NOT from a row (DTO fields, computed values, function returns), inline `value ?? undefined` is enough — TypeScript narrows `T | null` to `T | undefined` automatically at the `??` expression. Do NOT wrap the single-field case in a helper.
3. **Date fields: two helpers, clear boundary.** `timestampToISO(value: number | Date): string` is the default for `rowToEntity` — audit columns from `createUpdateTimestamps` are `.notNull()`, so the DB row hands back a real `number`. `timestampToISOOrUndefined(value: number | Date | null | undefined): string | undefined` is reserved for merge paths where the source row itself may be absent (e.g. a builtin/preset definition without a preference row). Do NOT use `timestampToISOOrUndefined` as a "safer default" — if your input is a DB row, it always has these fields.

For function signature details and design-decision history (e.g. why shallow-not-recursive, why not `dnull`), see [services/utils/README.md](../../../src/main/data/services/utils/README.md).

### Service with Transaction

```typescript
async createTopicWithMessage(data: CreateTopicWithMessageDto) {
  const db = application.get('DbService').getDb()

  return await db.transaction(async (tx) => {
    const [topic] = await tx.insert(topicTable).values(data.topic).returning()

    const [message] = await tx.insert(messageTable).values({
      ...data.message,
      topicId: topic.id
    }).returning()

    return { topic, message }
  })
}
```

### Transaction Method Naming

Service methods accepting a Drizzle transaction:

| Rule | |
|---|---|
| Parameter position | `tx` is the **first** parameter |
| Method name | ends with `Tx` |
| Parameter type | `Pick<DbType, '...'>` with the minimum operations needed |
| Non-Tx wrapper | optional; thin `db.transaction(...)` wrapper, only when a caller needs to own the transaction |

```ts
// ✅
async purgeForEntityTx(tx: Pick<DbType, 'delete'>, entityType: EntityType, entityId: string): Promise<void>

// ❌ tx not first
async purgeForEntity(entityType: EntityType, entityId: string, tx: Pick<DbType, 'delete'>)
// ❌ missing Tx suffix
async purgeForEntity(tx: Pick<DbType, 'delete'>, entityType: EntityType, entityId: string)
// ❌ over-broad type
async purgeForEntityTx(tx: DbType, entityType: EntityType, entityId: string)
```

Optional non-Tx wrapper:

```ts
async purgeForEntity(entityType: EntityType, entityId: string): Promise<void> {
  await this.db.transaction((tx) => this.purgeForEntityTx(tx, entityType, entityId))
}
```

## Repository Pattern (Strongly Discouraged)

> **⚠️ Do NOT create Repository files by default.** Services handle both business logic and data access directly via Drizzle ORM. This is an intentional design decision.
>
> Only create a separate Repository when you are **1000% certain** it is absolutely necessary — e.g., extremely complex multi-table queries with joins/CTEs that would make the Service unreadable, AND the query logic is reused across multiple services.
>
> If in doubt, keep it in the Service. The overhead of an extra architectural layer is not justified for this project's scale (Electron desktop app + SQLite).

### Registry Services (Supplementary)

> In rare cases where a handler needs to merge **read-only preset data**
> (shipped JSON/TS) with database data, a Registry Service may be introduced.
> This is uncommon — the vast majority of services are Entity Services.

Registry Services:
- **Do NOT own a database table** and **do NOT access the database directly**
- Obtain DB data by calling the owning Entity Service
- Named `{Domain}RegistryService` (e.g., `ProviderRegistryService`)
- Primary data source is static preset data (JSON files, TS constants)
- All methods are read-only (no inserts, updates, or deletes)

See [Layered Preset Pattern](./best-practice-layered-preset-pattern.md) for the general architecture.

### Registry Sub-Resource Endpoints

Registry data reaches the renderer through sub-resource endpoints on the
owning entity. Three rules govern their shape.

**GET only.** Registry endpoints are stateless reads — preset merged with
DB rows. `POST` is reserved for state changes; using it for reads breaks
SWR caching, request dedup, and retry safety. For composite IDs containing
`/`, use the greedy path form `:id*` (see
[Greedy Path Parameters](./api-design-guidelines.md#greedy-path-parameters)).
For batched lookups exceeding URL limits, split into multiple GETs — DataApi
dedup makes burst reads cheap.

**Colon-notation for derived views.** When the sub-resource name is
ambiguous, disambiguate with AIP-136 colon notation:

| Shape | Use for |
|---|---|
| `GET /:parent/:id/:sub` | List the merged collection |
| `GET /:parent/:id/:sub:action` | Compute a derived view |
| `GET /:parent/:id/:sub/:childId` | Look up one merged item |

**Registry packages are main-only.** Packages like
`@cherrystudio/provider-registry` ship the preset data Registry Services
merge against. **Renderer code must not import them.** Two reasons:

- **Bundle waste.** Registry packages are large (preset catalogs, vendor
  metadata, icons). Importing them in the renderer ships the same payload
  twice — once in the main bundle, once in every renderer entry that
  touches it — for data the renderer already gets via DataApi.
- **Merge already lives in main.** Registry Services merge preset + DB
  rows on the main side. Re-doing the merge in the renderer duplicates
  logic and re-introduces preset-version drift this layer was designed
  to remove.

The merged result reaches the renderer exclusively through these endpoints.

## Error Handling

### Using DataApiErrorFactory

```typescript
import { DataApiErrorFactory } from '@shared/data/api'

// Not found
throw DataApiErrorFactory.notFound('Topic', id)

// Validation error
throw DataApiErrorFactory.validation({
  name: ['Name is required', 'Name must be at least 3 characters'],
  email: ['Invalid email format']
})

// Database error
try {
  await db.insert(table).values(data)
} catch (error) {
  throw DataApiErrorFactory.database(error, 'insert topic')
}

// Invalid operation
throw DataApiErrorFactory.invalidOperation(
  'delete root message',
  'cascade=true required'
)

// Conflict
throw DataApiErrorFactory.conflict('Topic name already exists')

// Timeout
throw DataApiErrorFactory.timeout('fetch topics', 3000)
```

## Adding New Endpoints

### Step-by-Step

1. **Define schema** in `packages/shared/data/api/schemas/`

```typescript
// schemas/topic.ts
export type TopicSchemas = {
  '/topics': {
    GET: { response: PaginatedResponse<Topic> }
    POST: { body: CreateTopicDto; response: Topic }
  }
}
```

2. **Register schema** in `schemas/index.ts`

```typescript
export type ApiSchemas = AssertValidSchemas<TopicSchemas & MessageSchemas>
```

3. **Create service** in `services/`

4. **Implement handler** in `handlers/`

5. **Register handler** in `handlers/index.ts`

## Best Practices

1. **Keep handlers thin**: Only extract params and call services
2. **Put logic in services**: All business rules and data access belong in services
3. **Do NOT create separate Repository files**: Services own data access directly via Drizzle ORM
4. **Always use `.returning()`**: Get inserted/updated data without re-querying
5. **Support transactions**: Accept optional `tx` parameter in service methods
6. **Validate in services**: Business validation belongs in the service layer
7. **Use error factory**: Consistent error creation with `DataApiErrorFactory`
8. **Use `nullsToUndefined` in `rowToEntity`**: Canonical SQLite NULL → `undefined` translation; shallow, not recursive (see [Row → Entity Mapping](#row--entity-mapping))
