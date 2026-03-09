---
name: v2-data-api
description: Build Main-process services and APIs that expose data from SQLite to renderers. Covers the Handler -> Service -> Repository layered architecture, API schema design, database patterns, preference schema, and business logic implementation. Use when adding endpoints, creating services, designing schemas, or refactoring business logic in the v2 data layer.
---

# V2 Data API: Main-Process Services (Phase 2 of 3)

Design and implement the Main-process layer that exposes SQLite data to renderers via type-safe IPC. This covers business logic, service architecture, and database access patterns.

**This skill enforces strict TDD (red-green-refactor).** For every unit of work: (1) write ONE failing test (red), (2) write the minimum code to make it pass (green), (3) refactor while keeping tests green. Repeat. Run `pnpm test:main` to verify.

**Related skills:**
- `v2-migrator` - Phase 1: Migrating legacy data into SQLite
- `v2-renderer` - Phase 3: Renderer hooks that consume these APIs

## System Selection

Before building a service, determine the right system:

| System | When to Use | Loss Impact | Example |
|--------|------------|-------------|---------|
| **DataApiService** | User-created business data, structured, can grow | **Severe** | Topics, messages, assistants, files |
| **PreferenceService** | User settings, fixed keys, stable values | Low | Theme, language, shortcuts, proxy config |
| **CacheService** | Regenerable/temporary, no backup needed | None | API responses, scroll positions |

**Decision flow:**
1. Can data be lost without user impact? -> CacheService (no Main service needed)
2. Is it a user setting with a fixed key? -> PreferenceService (schema-based)
3. Is it user-created data that grows unbounded? -> DataApiService (full service stack)

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Main Process                                                  │
│                                                                │
│  Handler (thin)                                                │
│    - Extract params from request                               │
│    - Call service, return result                                │
│    - NO business logic                                         │
│         │                                                      │
│         v                                                      │
│  Service (business logic)                                      │
│    - Validation, authorization                                 │
│    - Transaction coordination                                  │
│    - Domain workflows                                          │
│    - Orchestrates repositories or direct Drizzle               │
│         │                                                      │
│    ┌────┴────┐                                                 │
│    v         v                                                 │
│  Repository    Direct Drizzle                                  │
│  (complex)     (simple CRUD)                                   │
│    │              │                                            │
│    └──────┬───────┘                                            │
│           v                                                    │
│  SQLite (Drizzle ORM)                                          │
└──────────────────────────────────────────────────────────────┘
```

**When to use Repository vs Direct Drizzle:**

| Use Repository | Use Direct Drizzle |
|---|---|
| Complex queries (joins, subqueries, aggregations) | Simple CRUD |
| GB-scale data with pagination | Small datasets (< 100MB) |
| Complex multi-table transactions | Single-table operations |
| Reusable data access patterns | Domain-specific one-off queries |

## File Locations

| Layer | Location |
|-------|----------|
| Shared API types/schemas | `packages/shared/data/api/schemas/` |
| Handlers | `src/main/data/api/handlers/` |
| Services | `src/main/data/services/` |
| Repositories | `src/main/data/repositories/` (optional) |
| DB schemas | `src/main/data/db/schemas/` |
| Preference types | `packages/shared/data/preference/` |
| Cache schemas | `packages/shared/data/cache/cacheSchemas.ts` |

## Adding a DataApi Endpoint (Step-by-Step)

### Step 1: Define SQLite Schema

```typescript
// src/main/data/db/schemas/myDomain.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { uuidPrimaryKey, timestamps } from './helpers'

export const myDomainTable = sqliteTable('my_domain', {
  ...uuidPrimaryKey(),        // id: text, primary key, auto-generated UUID
  name: text('name').notNull(),
  description: text('description'),
  config: text('config', { mode: 'json' }).$type<MyConfig>(),
  ...timestamps(),            // createdAt, updatedAt (auto-managed)
})
```

**Schema conventions:**
- Table name: singular, snake_case (`my_domain` not `myDomains`)
- Export name: `xxxTable` (e.g., `myDomainTable`)
- Use helpers: `uuidPrimaryKey()`, `uuidPrimaryKeyOrdered()`, `timestamps()`
- JSON fields: `text('col', { mode: 'json' }).$type<T>()`
- Foreign keys: use `references(() => otherTable.id)` or `foreignKey` for self-referencing
- Soft delete: add `deletedAt` column when needed
- After changes: run `yarn db:migrations:generate`

See `docs/en/references/data/database-patterns.md` for full conventions.

### Step 2: Define API Schema (Shared Types)

```typescript
// packages/shared/data/api/schemas/myDomain.ts
export interface MyDomainSchemas {
  '/my-domains': {
    GET: {
      query?: { page?: number; limit?: number }
      response: PaginatedResponse<MyDomain>
    }
    POST: {
      body: CreateMyDomainDto
      response: MyDomain
    }
  }
  '/my-domains/:id': {
    GET: { response: MyDomain }
    PATCH: { body: Partial<UpdateMyDomainDto>; response: MyDomain }
    DELETE: { response: void }
  }
}
```

Register in `packages/shared/data/api/schemas/index.ts`:
```typescript
export type ApiSchemas = AssertValidSchemas<TopicSchemas & MessageSchemas & MyDomainSchemas>
```

**Path conventions:**
- Plural nouns, kebab-case: `/my-domains`, `/knowledge-bases`
- Nested resources: `/topics/:topicId/messages`
- Non-CRUD actions: `POST /topics/:id/archive`
- Query params for filtering/sorting: `?page=1&limit=20&sort=name&order=asc`

See `docs/en/references/data/api-design-guidelines.md` for full rules.

### Step 3: Write Service Tests (TDD Red Phase)

Write failing tests for the service before implementing it. Each test must fail (red) before you proceed to Step 4. Use the main-process test mocks.

```typescript
// src/main/data/services/__tests__/MyDomainService.test.ts
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { MyDomainService } from '../MyDomainService'

// Mock DbService
vi.mock('@data/db/DbService', () => ({
  DbService: {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([]) })
          }),
        })
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: '1', name: 'Test' }]) })
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: '1', name: 'Updated' }]) })
        })
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      }),
    },
    transaction: vi.fn(async (fn) => fn(/* tx mock */)),
  }
}))

describe('MyDomainService', () => {
  let service: MyDomainService

  beforeEach(() => {
    service = MyDomainService.getInstance()
    vi.clearAllMocks()
  })

  describe('create', () => {
    it('should validate required fields', async () => {
      await expect(service.create({ name: '' })).rejects.toThrow()
    })

    it('should create and return item', async () => {
      const result = await service.create({ name: 'Test' })
      expect(result.id).toBeDefined()
      expect(result.name).toBe('Test')
    })
  })

  describe('getById', () => {
    it('should throw NotFound for non-existent id', async () => {
      await expect(service.getById('non-existent')).rejects.toThrow()
    })
  })
})
```

**What to test:**
- Validation logic (required fields, format checks)
- Error cases (not found, conflicts, invalid operations)
- Business rules and domain workflows
- Transaction coordination (multi-table operations)
- Service method contracts (input -> output)

### Step 4: Implement the Service (TDD Green Phase + Refactor)

```typescript
// src/main/data/services/MyDomainService.ts
import { eq, desc, sql } from 'drizzle-orm'
import { DbService } from '@data/db/DbService'
import { myDomainTable } from '@data/db/schemas/myDomain'
import { DataApiErrorFactory } from '@shared/data/api'
import { loggerService } from '@logger'

const logger = loggerService.withContext('MyDomainService')

export class MyDomainService {
  private static instance: MyDomainService
  static getInstance() {
    return (this.instance ??= new MyDomainService())
  }

  async list({ page = 1, limit = 20 }) {
    const offset = (page - 1) * limit
    const [items, [{ count }]] = await Promise.all([
      DbService.db.select().from(myDomainTable)
        .orderBy(desc(myDomainTable.updatedAt))
        .limit(limit).offset(offset),
      DbService.db.select({ count: sql<number>`count(*)` }).from(myDomainTable)
    ])
    return { items, total: count, page, limit }
  }

  async getById(id: string) {
    const [item] = await DbService.db.select().from(myDomainTable)
      .where(eq(myDomainTable.id, id)).limit(1)
    if (!item) throw DataApiErrorFactory.notFound('MyDomain', id)
    return item
  }

  async create(data: CreateMyDomainDto) {
    this.validate(data)
    const [item] = await DbService.db.insert(myDomainTable).values(data).returning()
    logger.info(`Created ${item.id}`)
    return item
  }

  async update(id: string, data: Partial<UpdateMyDomainDto>) {
    await this.getById(id) // throws if not found
    const [item] = await DbService.db.update(myDomainTable)
      .set(data).where(eq(myDomainTable.id, id)).returning()
    return item
  }

  async delete(id: string) {
    await this.getById(id)
    await DbService.db.delete(myDomainTable).where(eq(myDomainTable.id, id))
  }

  private validate(data: CreateMyDomainDto) {
    if (!data.name?.trim()) {
      throw DataApiErrorFactory.validation({ name: ['Name is required'] })
    }
  }
}
```

**Service responsibilities:**
- Business validation and authorization
- Transaction coordination (`DbService.transaction()`)
- Domain-specific workflows and orchestration
- Error handling with `DataApiErrorFactory`
- Logging via `loggerService`

**Transactions:**
```typescript
async createWithChildren(data: CreateWithChildrenDto) {
  return await DbService.transaction(async (tx) => {
    const [parent] = await tx.insert(parentTable).values(data.parent).returning()
    await tx.insert(childTable).values(
      data.children.map(c => ({ ...c, parentId: parent.id }))
    )
    return parent
  })
}
```

**When refactoring business logic from Redux:**
- Old Redux: business logic lived in thunks, selectors, and React components
- New v2: business logic lives in Services (Main process)
- Extract validation, computation, and side effects from Redux thunks into Service methods
- Services can call other services for cross-domain workflows
- Keep services stateless - state lives in SQLite

### Step 5: Implement the Handler

```typescript
// src/main/data/api/handlers/myDomain.ts
import type { ApiImplementation } from '@shared/data/api'
import { MyDomainService } from '@data/services/MyDomainService'

export const myDomainHandlers: Partial<ApiImplementation> = {
  '/my-domains': {
    GET: async ({ query }) => MyDomainService.getInstance().list(query ?? {}),
    POST: async ({ body }) => MyDomainService.getInstance().create(body),
  },
  '/my-domains/:id': {
    GET: async ({ params }) => MyDomainService.getInstance().getById(params.id),
    PATCH: async ({ params, body }) => MyDomainService.getInstance().update(params.id, body),
    DELETE: async ({ params }) => { await MyDomainService.getInstance().delete(params.id) },
  }
}
```

Register in `src/main/data/api/handlers/index.ts`:
```typescript
export const allHandlers: ApiImplementation = {
  ...topicHandlers,
  ...myDomainHandlers,  // <-- add
}
```

**Handler rules:**
- THIN: extract params -> call service -> return result
- NO business logic, validation, or error handling (service does that)
- Status codes inferred automatically (200 for data, 204 for void)

### Step 6: Repository (optional, for complex domains)

```typescript
// src/main/data/repositories/MyDomainRepository.ts
import { eq, desc, sql, and, like } from 'drizzle-orm'
import { DbService } from '@data/db/DbService'
import { myDomainTable } from '@data/db/schemas/myDomain'

export class MyDomainRepository {
  async findWithRelations(id: string, tx?: Transaction) {
    const db = tx || DbService.db
    // Complex join query...
  }

  async search(query: string, options: SearchOptions, tx?: Transaction) {
    const db = tx || DbService.db
    // Full-text search, aggregations...
  }
}
```

Always accept optional `tx` parameter for transaction support.

## Adding a Preference Key

For user settings that don't need full DataApi:

### Step 1: Define Type (if custom)
```typescript
// packages/shared/data/preference/preferenceTypes.ts
export enum MyFeatureMode { auto = 'auto', manual = 'manual', disabled = 'disabled' }
```

### Step 2: Add to Schema
```typescript
// packages/shared/data/preference/preferenceSchemas.ts
export interface PreferenceSchemas {
  default: {
    // ... existing keys (alphabetically sorted)
    'feature.my_feature.enabled': boolean
    'feature.my_feature.mode': PreferenceTypes.MyFeatureMode
  }
}

export const DefaultPreferences: PreferenceSchemas = {
  default: {
    // ... existing defaults (alphabetically sorted)
    'feature.my_feature.enabled': true,
    'feature.my_feature.mode': PreferenceTypes.MyFeatureMode.auto,
  }
}
```

**Key naming:** `namespace.category.key_name`
- At least 2 dot-separated segments
- Lowercase letters, numbers, underscores only
- Pattern: `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/`
- Namespaces: `app.*`, `chat.*`, `feature.*`, `ui.*`, `data.*`, `shortcut.*`
- Boolean keys: use `.enabled` suffix

**Design principles:**
- Prefer flat over nested (split objects into individual keys)
- Keep values atomic (one preference = one logical setting)
- Provide sensible defaults in `DefaultPreferences`

See `docs/en/references/data/preference-schema-guide.md` for full guide.

## Layered Preset Pattern (Predefined Config + User Overrides)

Use this pattern when a feature has a **predefined list of items** (tools, providers, templates) with **user-customizable settings per item**. Instead of storing full config for every item, store only the user's deviations from defaults.

**When to use:**
- Feature has a fixed, code-defined list of options (e.g., CLI tools, AI providers)
- Users can customize per-item settings (model, API key, env vars)
- Most items keep default values — only a few are customized

**Architecture:**

```
packages/shared/data/presets/<domain>.ts    → Preset definitions (code, not DB)
packages/shared/data/preference/            → Overrides preference key (DB)
```

### Step 1: Define Presets (Shared Package)

```typescript
// packages/shared/data/presets/my-feature.ts
export interface MyFeaturePreset {
  id: string
  name: string
  modelId: string | null
  config: string
}

export const PRESETS_MY_FEATURE: MyFeaturePreset[] = [
  { id: 'option-a', name: 'Option A', modelId: null, config: '' },
  { id: 'option-b', name: 'Option B', modelId: null, config: '' },
]

// Override = partial preset (only non-default fields)
export type MyFeatureOverride = Partial<Omit<MyFeaturePreset, 'id' | 'name'>>
export type MyFeatureOverrides = Record<string, MyFeatureOverride>
```

### Step 2: Add Overrides Preference Key

```typescript
// packages/shared/data/preference/preferenceSchemas.ts
import type { MyFeatureOverrides } from '@shared/data/presets/my-feature'

// In PreferenceSchemas interface:
'feature.my_feature.overrides': MyFeatureOverrides  // default: {}

// In DefaultPreferences:
'feature.my_feature.overrides': {},
```

**Key design principles:**
- Presets are **immutable code** — updated via app releases, not user action
- Overrides store **delta only** — empty `{}` means all defaults
- Override keys match preset IDs — `{ 'option-a': { modelId: 'm1' } }`
- The merge happens at read time (renderer), not write time

### Step 3: Merge Logic (Service or Hook)

The effective config for an item = preset defaults merged with user overrides:

```typescript
function getEffectiveConfig(presetId: string, overrides: MyFeatureOverrides): MyFeaturePreset {
  const preset = PRESETS_MY_FEATURE.find(p => p.id === presetId)
  if (!preset) throw new Error(`Unknown preset: ${presetId}`)
  return { ...preset, ...overrides[presetId] }
}
```

See `docs/en/references/data/best-practice-layered-preset-pattern.md` for full documentation and `packages/shared/data/presets/code-tools.ts` for a reference implementation.

## Cross-Domain References (Stale Object Bug)

### The Legacy Problem

In Redux, domains often stored **full copies** of objects from other domains instead of just IDs. When the original was deleted, the copy became stale — a phantom reference the user couldn't fix.

**Inventory of problematic embeddings in Redux:**

| Host Domain | Embedded Guest | Field | Impact |
|-------------|---------------|-------|--------|
| Assistant | `Model` (full) | `model`, `defaultModel` | Model deleted → assistant shows stale model info |
| Assistant | `Topic[]` (full) | `topics` | Topic deleted → assistant still has copy |
| Assistant | `KnowledgeBase[]` (full) | `knowledge_bases` | KB deleted → assistant shows deleted KB |
| Assistant | `MCPServer[]` (full) | `mcpServers` | Server removed → assistant still references it |
| Message | `Model` (full) | `model`, `mentions` | Model removed → stale metadata in history |
| MessageBlock | `Model` (full) | `model` | Same as above, per-block level |
| LLM store | `Model` (full) | `defaultModel`, `quickModel`, etc. | 4+ full model copies go stale |

### v2 Solution: FK IDs Only

The v2 database replaces full-object embeddings with **FK ID references**. The full object can always be fetched via the FK ID — no need to store redundant copies or maintain separate snapshot types.

```typescript
// message table:
assistantId: text(),  // FK → query assistant table for full object
modelId: text(),      // FK → query model/provider for full object
```

### When to Use Which Pattern

| Scenario | Pattern | Example |
|----------|---------|---------|
| **Reference can be deleted** and host must survive | FK ID with `onDelete: 'set null'` | topic→assistant, message→model |
| **Reference is owned** by host (cascade delete) | FK with `onDelete: 'cascade'` | topic→messages |
| **Reference is organizational** (grouping) | FK with `onDelete: 'set null'` | topic→group |
| **Reference is config** (list of IDs) | JSON array of IDs | assistant→knowledgeBaseIds |
| **Data is immutable history** (citations, tool results) | Embedded JSON (full copy OK) | message→citation data |

### API Response Design

APIs should **not** re-embed full referenced objects. Return FK IDs and let the renderer fetch full objects via separate queries when needed.

```typescript
// API schema - topic response includes FK ID, not full assistant
'/topics/:id': {
  GET: {
    response: {
      id: string
      name: string
      assistantId: string | null  // FK — renderer queries assistant separately
      // NOT: assistant: Assistant  ← don't embed full objects
    }
  }
}
```

## Error Handling

```typescript
import { DataApiErrorFactory } from '@shared/data/api'

// Standard error factories
throw DataApiErrorFactory.notFound('Topic', id)
throw DataApiErrorFactory.validation({ name: ['Required'], email: ['Invalid format'] })
throw DataApiErrorFactory.conflict('Name already exists')
throw DataApiErrorFactory.database(error, 'insert topic')
throw DataApiErrorFactory.invalidOperation('delete root message', 'cascade=true required')
throw DataApiErrorFactory.timeout('fetch topics', 3000)
```

## Checklist

### TDD Cycle (red-green-refactor)
- [ ] Service tests written and **failing** (red) in `src/main/data/services/__tests__/`
- [ ] Minimum service code written to make tests pass (green)
- [ ] Validation logic tests added (red), then implemented (green)
- [ ] Error case tests added (red): not found, invalid operations, then handled (green)
- [ ] Business rule tests added (red): domain workflows, transaction coordination
- [ ] Code refactored with all tests still passing
- [ ] Tests pass: `pnpm test:main`

### DataApi Endpoint (implementation details)
- [ ] SQLite schema in `src/main/data/db/schemas/` + migrations generated
- [ ] API schema in `packages/shared/data/api/schemas/` + registered in index
- [ ] Service with business logic in `src/main/data/services/`
- [ ] Handler (thin) in `src/main/data/api/handlers/` + registered in index
- [ ] Repository (if complex domain) in `src/main/data/repositories/`
- [ ] Error handling via `DataApiErrorFactory`
- [ ] Logging via `loggerService` with context
- [ ] Business logic extracted from Redux thunks/selectors into Service

### Preference Key
- [ ] Custom type in `preferenceTypes.ts` (if needed)
- [ ] Key + type in `PreferenceSchemas` interface
- [ ] Default value in `DefaultPreferences`
- [ ] Key naming follows conventions
- [ ] Layered Preset pattern applied (if feature has predefined list + per-item overrides)
- [ ] Preset definitions in `packages/shared/data/presets/` (if using Layered Preset)

### Quality
- [ ] All tests pass: `pnpm test`
- [ ] `pnpm lint && pnpm format` pass
- [ ] `pnpm build:check` passes

## Documentation References

- `docs/en/references/data/README.md` - System selection guide
- `docs/en/references/data/data-api-overview.md` - DataApi architecture
- `docs/en/references/data/data-api-in-main.md` - Main-process patterns
- `docs/en/references/data/api-design-guidelines.md` - RESTful conventions
- `docs/en/references/data/api-types.md` - Type system
- `docs/en/references/data/database-patterns.md` - Schema conventions
- `docs/en/references/data/preference-overview.md` - Preference architecture
- `docs/en/references/data/preference-schema-guide.md` - Adding preference keys
- `docs/en/references/data/best-practice-layered-preset-pattern.md` - Layered presets
