---
name: v2-migrator
description: Implement migrators that move legacy Redux/Dexie/ElectronStore data into SQLite. Use when creating or modifying migrators in the v2 migration pipeline. This skill only covers data migration - for Main-process services see v2-data-api, for Renderer consumption see v2-renderer.
---

# V2 Migration: Data Migration (Phase 1 of 3)

Move legacy data (Redux Persist, Dexie IndexedDB, ElectronStore) into SQLite tables. This is a one-shot migration that runs before the app switches to the v2 architecture.

**This skill enforces strict TDD (red-green-refactor).** For every unit of work: (1) write ONE failing test (red), (2) write the minimum code to make it pass (green), (3) refactor while keeping tests green. Repeat. Run `pnpm test:main` to verify.

**Related skills:**
- `v2-data-api` - Phase 2: Main-process services that expose migrated data
- `v2-renderer` - Phase 3: Renderer hooks and services that consume data

## Data Source Classification

Before writing a migrator, confirm which data needs migration:

| Category | v2 Target | Migrate? |
|----------|-----------|----------|
| **preferences** (settings) | `preferenceTable` | Yes - via PreferencesMigrator |
| **user_data** (topics, messages, assistants) | Domain SQLite tables | Yes - domain migrators |
| **cache** (favicon, computed results) | CacheService | No - regenerable |
| **runtime** (selected topic, UI state) | CacheService or React state | No - session only |

**Dexie Settings source:** The Dexie `settings` table is a generic KV store (`{ id: string, value: any }`) that also contains user preferences. These are classified under `dexieSettings` in `classification.json` (separate from the `dexie` section which covers business data tables). The `dexieSettings` entries are **manually maintained** — they are not auto-extracted by the inventory script. For the full key inventory, see [PR #10162 comment](https://github.com/CherryHQ/cherry-studio/pull/10162#issuecomment-4010796619). Note that dynamic keys (containing `${}` patterns) require complex mapping logic — they cannot use simple 1:1 `DEXIE_SETTINGS_MAPPINGS`.

**Cross-category migration:** In the legacy Redux store, some data that is logically a user preference lives under domain slices (e.g., `knowledge`, `memory`, `nutstore`) rather than `settings`. During migration, these fields must be reclassified and routed to `preferenceTable` instead of domain tables. Examples:

| Redux Slice | Legacy Key | v2 Target | Rationale |
|---|---|---|---|
| `memory` | `memory.embedderModel` | `preference: feature.memory.embedder_model_id` | Full `Model` object → extract and store only model ID |
| `nutstore` | `nutstore.autoSyncEnabled` | `preference: data.nutstore.auto_sync_enabled` | Toggle setting |
| `knowledge` | `knowledge.defaultEmbedModel` | `preference: feature.knowledge.default_embed_model_id` | Full `Model` object → extract and store only model ID |
| `selectionStore` | `selectionStore.quickAssistantId` | `preference: feature.quick_assistant.id` | User selection |

When implementing a domain migrator, always check whether each field is truly user data (belongs in a domain table) or actually a user preference (belongs in `preferenceTable`). Consult `v2-refactor-temp/tools/data-classify/classification.json` for the authoritative classification. Preference-type fields from domain slices should be added to the PreferencesMigrator's `REDUX_STORE_MAPPINGS` (which already supports non-settings categories like `memory`, `nutstore`, `shortcuts`, `note`, `selectionStore`).

Full inventory: `v2-refactor-temp/tools/data-classify/classification.json` (391 items)

## Architecture

```
Renderer Process                          Main Process
+-----------------------+                 +---------------------------+
| Redux Persist Store   |---IPC export--->| ReduxStateReader          |
| (localStorage)        |                 |   .get(category, key)     |
+-----------------------+                 +---------------------------+
                                                    |
+-----------------------+                           v
| Dexie IndexedDB       |---JSON export-->| DexieFileReader            |
| (topics, messages,    |                 |   .readTable() / stream    |
|  blocks, files...)    |                 +---------------------------+
+-----------------------+                           |
                                                    v
+-----------------------+                 +---------------------------+
| Dexie settings table  |---JSON export-->| DexieSettingsReader        |
| (KV: translate,       |                 |   .get(key) / .getAll()   |
|  pinned, images...)   |                 +---------------------------+
+-----------------------+                           |
                                                    v
+-----------------------+                 +---------------------------+
| ElectronStore         |---direct------->| ConfigManager             |
| (electron-store.json) |                 |   .get(key)               |
+-----------------------+                 +---------------------------+
                                                    |
                                                    v
                                          +---------------------------+
                                          | MigrationEngine           |
                                          |   prepare/execute/validate|
                                          +---------------------------+
                                                    |
                                                    v
                                          +---------------------------+
                                          | SQLite (Drizzle ORM)      |
                                          +---------------------------+
```

**Multi-renderer note:** Cherry Studio has multiple renderer windows (main app, mini window, selection toolbar). Only the dedicated migration window triggers migration. Main process owns all migration logic; renderers receive progress via IPC.

## Key Files

| File | Purpose |
|------|---------|
| `src/main/data/migration/v2/core/MigrationEngine.ts` | Orchestrator: 3-phase pipeline, progress tracking |
| `src/main/data/migration/v2/core/MigrationContext.ts` | Shared context: sources, db, sharedData, logger |
| `src/main/data/migration/v2/migrators/BaseMigrator.ts` | Abstract base class |
| `src/main/data/migration/v2/migrators/index.ts` | Migrator registration (execution order) |
| `src/main/data/migration/v2/migrators/PreferencesMigrator.ts` | Reference impl: settings migration |
| `src/main/data/migration/v2/migrators/ChatMigrator.ts` | Reference impl: complex multi-source migration |
| `src/main/data/migration/v2/migrators/mappings/` | Mapping definitions and transform functions |
| `src/main/data/migration/v2/utils/ReduxStateReader.ts` | Dot-path accessor for Redux state |
| `src/main/data/migration/v2/utils/DexieFileReader.ts` | JSON table reader with streaming |
| `src/main/data/migration/v2/utils/JSONStreamReader.ts` | Memory-efficient batch streaming |
| `packages/shared/data/migration/v2/types.ts` | Shared types: stages, results, stats |
| `src/main/data/migration/v2/window/MigrationIpcHandler.ts` | IPC flow control |
| `src/renderer/src/store/` | Redux slices (source data shapes) |
| `v2-refactor-temp/tools/data-classify/` | Toolchain: classification, code generation, validation |
| `v2-refactor-temp/tools/data-classify/data/classification.json` | Authoritative classification of all 391 legacy data items |
| `v2-refactor-temp/tools/data-classify/data/target-key-definitions.json` | Target keys for complex mappings and v2-new-only preferences |

## Migrator Contract

Every migrator extends `BaseMigrator` with a **three-phase lifecycle**:

```typescript
import { BaseMigrator } from './BaseMigrator'
import type { MigrationContext } from '../core/MigrationContext'
import type { PrepareResult, ExecuteResult, ValidateResult } from '@shared/data/migration/v2/types'

export class MyDomainMigrator extends BaseMigrator {
  id = 'my_domain'
  name = 'My Domain Migrator'
  description = 'Migrates X from legacy stores to SQLite'
  order = 5 // Lower runs first

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    // Phase 1: Dry-run - count items, check source availability, NO DB writes
    // Return { success, itemCount, warnings? }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    // Phase 2: Batch inserts with transactions, report progress
    // Return { success, processedCount, error? }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    // Phase 3: Compare source vs target counts, sample-check records
    // Return { success, errors[], stats: { sourceCount, targetCount, skippedCount } }
    // Engine fails if targetCount < sourceCount - skippedCount
  }
}
```

## Data Access in Migrators

```typescript
// Redux state
const settings = ctx.sources.redux.getCategory('settings')
const theme = ctx.sources.redux.get('settings', 'theme')
const editorEnabled = ctx.sources.redux.get('settings', 'codeEditor.enabled')
if (ctx.sources.redux.hasCategory('knowledge')) { /* ... */ }

// Dexie - small table (load all at once)
const notes = await ctx.sources.dexie.readTable<OldNote>('knowledge_notes')

// Dexie - large table (streaming)
const reader = ctx.sources.dexie.createStreamReader('topics')
const count = await reader.count()
await reader.readInBatches(50, async (batch) => { /* process */ })
const sample = await reader.readSample(5)  // validation sampling

// Dexie settings table (KV store)
const translateModel = ctx.sources.dexieSettings.get('translate:model')
const allSettings = ctx.sources.dexieSettings.getAll()

// ElectronStore
const zoomFactor = ctx.sources.config.get('ZoomFactor')

// Cross-migrator data sharing
ctx.sharedData.set('assistantIdMap', idMap)  // producer (earlier migrator)
const idMap = ctx.sharedData.get('assistantIdMap')  // consumer (later migrator)
```

## Step-by-Step: New Migrator

### 1. Understand Source Data
- Read the Redux slice in `src/renderer/src/store/` for data shape
- Check Dexie tables in `src/renderer/src/services/db.ts` if applicable
- Check Dexie `settings` table keys (classified under `dexieSettings` in `classification.json`) — these are KV pairs that may also need preference migration
- Confirm classification in `v2-refactor-temp/tools/data-classify/data/classification.json`

### 2. Understand Target Schema
- Read target SQLite schema in `src/main/data/db/schemas/`
- Map source fields to target columns
- Identify transformations (type conversions, restructuring, merging)
- For preference migrations: check if target keys already exist in `v2-refactor-temp/tools/data-classify/data/target-key-definitions.json`

### 3. Create Mapping File (if needed)

**For preference migrations:** `PreferencesMappings.ts` and `preferenceSchemas.ts` are **auto-generated** by the `v2-refactor-temp/tools/data-classify` toolchain. For simple 1:1 preference mappings, update `classification.json` and run `npm run generate` instead of editing the generated files directly. See the `v2-data-api` skill for the full workflow. For complex mappings or keys with custom types, you may need to add entries manually.

The generated `PreferencesMappings.ts` includes a `DEXIE_SETTINGS_MAPPINGS` array for simple 1:1 mappings from Dexie settings keys to preference target keys. For complex Dexie settings mappings (dynamic keys, value transformations), use `ComplexPreferenceMappings` with `source: 'dexie-settings'` instead.

**Simple 1:1 mapping** (like PreferencesMappings):
```typescript
// src/main/data/migration/v2/migrators/mappings/MyDomainMappings.ts
export interface FieldMapping {
  originalKey: string   // Source field path (dot notation)
  targetKey: string     // Target column or key
  transform?: (value: unknown) => unknown
}

export const MY_DOMAIN_MAPPINGS: FieldMapping[] = [
  { originalKey: 'name', targetKey: 'display_name' },
  { originalKey: 'config.enabled', targetKey: 'is_enabled', transform: Boolean },
]
```

**Complex mapping** (like ComplexPreferenceMappings - 1:N, N:1, or cross-source):
```typescript
export interface ComplexMapping {
  id: string
  description: string
  sources: Record<string, SourceDefinition>
  targetKeys: string[]
  transform: (sources: Record<string, unknown>) => Record<string, unknown>
}
```

For complex mapping target keys, add them to `v2-refactor-temp/tools/data-classify/data/target-key-definitions.json` so that the generated `preferenceSchemas.ts` includes their type and default value.

### 4. Write Tests for Transformation Functions (TDD Red Phase)

**Write failing tests first.** Each test should fail (red) before you write any transformation code. Only write enough code to make each test pass (green), then refactor.

Test location: colocated `__tests__/` directories next to the code being tested (e.g., `migrators/mappings/__tests__/MyDomainMappings.test.ts`).

```typescript
// src/main/data/migration/v2/migrators/mappings/__tests__/MyDomainMappings.test.ts
import { describe, expect, it } from 'vitest'
import { transformRecord } from '../MyDomainMappings'

describe('MyDomainMappings', () => {
  describe('transformRecord', () => {
    it('should transform basic fields', () => {
      const old = { id: 'abc', name: 'Test', createdAt: 1700000000000 }
      const result = transformRecord(old)
      expect(result.id).toBe('abc')
      expect(result.display_name).toBe('Test')
      expect(result.created_at).toBe('2023-11-14T22:13:20.000Z')
    })

    it('should handle missing optional fields', () => {
      const old = { id: 'abc', name: 'Test' }
      const result = transformRecord(old)
      expect(result.created_at).toBeDefined() // falls back to now
    })

    it('should handle null/undefined input gracefully', () => {
      const old = { id: 'abc', name: null, createdAt: undefined }
      const result = transformRecord(old)
      expect(result.display_name).toBe('') // or whatever default
    })

    it('should generate new ID for duplicates', () => {
      // Test with duplicate detection logic
    })
  })
})
```

**What to test:**
- Each transformation function (pure, no DB dependency)
- Edge cases: null/undefined fields, empty strings, invalid dates
- Mapping completeness: all source fields accounted for
- Complex mappings: multi-source merging, conditional logic
- ID deduplication logic

### 5. Write Transformation Functions (TDD Green Phase)

Implement the minimum code to make the tests from step 4 pass. Pure functions in a separate mappings file:
```typescript
interface OldRecord { /* legacy shape */ }
interface NewRecord { /* SQLite shape */ }

export function transformRecord(old: OldRecord, lookupData?: Map<string, any>): NewRecord {
  return {
    id: old.id,
    created_at: old.createdAt ? new Date(old.createdAt).toISOString() : new Date().toISOString(),
    // ... field transformations
  }
}
```

### 6. Write Tests for Migrator Phases (TDD Red Phase)

Write failing tests for the migrator's prepare/execute/validate phases by mocking `MigrationContext`. Each test must fail before you proceed to step 7:

```typescript
// src/main/data/migration/v2/migrators/__tests__/MyDomainMigrator.test.ts
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { MyDomainMigrator } from '../MyDomainMigrator'

// Mock MigrationContext
function createMockContext(reduxData: Record<string, any> = {}, dbRows: any[] = []) {
  return {
    sources: {
      redux: {
        get: vi.fn((category, key) => {
          const cat = reduxData[category]
          if (!cat || !key) return cat
          return key.split('.').reduce((o, k) => o?.[k], cat)
        }),
        getCategory: vi.fn((cat) => reduxData[cat]),
        hasCategory: vi.fn((cat) => cat in reduxData),
      },
      dexie: { readTable: vi.fn(), createStreamReader: vi.fn(), tableExists: vi.fn() },
      config: { get: vi.fn() },
    },
    db: {
      transaction: vi.fn(async (fn) => fn({
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })
      })),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue([{ count: dbRows.length }])
      }),
    },
    sharedData: new Map(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
}

describe('MyDomainMigrator', () => {
  let migrator: MyDomainMigrator

  beforeEach(() => {
    migrator = new MyDomainMigrator()
    migrator.reportProgress = vi.fn()
  })

  describe('prepare', () => {
    it('should count source items', async () => {
      const ctx = createMockContext({ mySlice: { items: [{id:'1'}, {id:'2'}] } })
      const result = await migrator.prepare(ctx as any)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2)
    })

    it('should handle empty source', async () => {
      const ctx = createMockContext({})
      const result = await migrator.prepare(ctx as any)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })
  })

  describe('validate', () => {
    it('should pass when counts match', async () => {
      const ctx = createMockContext(
        { mySlice: { items: [{id:'1'}, {id:'2'}] } },
        [{}, {}] // 2 rows in DB
      )
      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(true)
      expect(result.stats.sourceCount).toBe(2)
      expect(result.stats.targetCount).toBe(2)
    })
  })
})
```

### 7. Implement the Migrator (TDD Green Phase)

Write the minimum code to make the tests from step 6 pass. Then refactor while keeping all tests green.

**Template - small dataset (fits in memory):**
```typescript
import { loggerService } from '@logger'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('MyDomainMigrator')

export class MyDomainMigrator extends BaseMigrator {
  id = 'my_domain'; name = 'My Domain'; description = '...'; order = 5

  async prepare(ctx) {
    const items = ctx.sources.redux.get('mySlice', 'items') ?? []
    return { success: true, itemCount: items.length }
  }

  async execute(ctx) {
    const items = ctx.sources.redux.get('mySlice', 'items') ?? []
    const BATCH = 100; let processed = 0; let skipped = 0

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH)
      const rows = []
      for (const item of batch) {
        try { rows.push(transform(item)) }
        catch (e) { logger.warn(`Skip ${item.id}: ${e}`); skipped++ }
      }
      await ctx.db.transaction(async (tx) => {
        await tx.insert(targetTable).values(rows)
      })
      processed += rows.length
      this.reportProgress(Math.round(((processed + skipped) / items.length) * 100),
        `Migrated ${processed}/${items.length}`)
    }
    return { success: true, processedCount: processed }
  }

  async validate(ctx) {
    const sourceCount = (ctx.sources.redux.get('mySlice', 'items') ?? []).length
    const [{ count }] = await ctx.db.select({ count: sql`count(*)` }).from(targetTable)
    return {
      success: Number(count) >= sourceCount,
      errors: [], stats: { sourceCount, targetCount: Number(count), skippedCount: 0 }
    }
  }
}
```

**Template - large dataset (streaming):**
```typescript
async execute(ctx) {
  const reader = ctx.sources.dexie.createStreamReader('myLargeTable')
  const total = await reader.count()
  let processed = 0

  await reader.readInBatches(50, async (batch) => {
    const rows = batch.map(item => transform(item))
    await ctx.db.transaction(async (tx) => {
      await tx.insert(targetTable).values(rows)
    })
    processed += rows.length
    this.reportProgress(Math.round((processed / total) * 100),
      `Migrated ${processed}/${total}`)
  })
  return { success: true, processedCount: processed }
}
```

### 8. Register ReduxExporter (if migrating a Redux slice)

If the migrator reads from a Redux slice, the slice must be exported by the renderer during migration. Register it in:

```typescript
// src/renderer/src/windows/migrationV2/exporters/ReduxExporter.ts
const SLICES_TO_EXPORT = [
  'settings',
  'llm',
  // ... existing slices
  'myNewSlice',  // <-- add your slice here
]
```

**Why:** The migration runs in the Main process, but Redux state lives in the renderer's localStorage. `ReduxExporter` serializes registered slices and sends them to Main via IPC. If you forget this step, `ctx.sources.redux.get('mySlice', ...)` will return `undefined` for all keys.

**When to skip:** If your migrator only reads from Dexie or ElectronStore (not Redux), skip this step.

### 9. Register Migrator

1. Add to `src/main/data/migration/v2/migrators/index.ts` with correct `order`
2. Add target table to `MigrationEngine.verifyAndClearNewTables` (child tables before parents)

### 10. Document

Create `src/main/data/migration/v2/migrators/README-<MigratorName>.md`:
- Data sources and target tables
- Field mappings (source -> target)
- Key transformations
- Dropped fields and rationale
- Edge cases and data quality handling

## Common Transformation Patterns

### ID Handling
```typescript
import { v4 as uuidv4 } from 'uuid'
const seenIds = new Set<string>()
function ensureUniqueId(id: string): string {
  if (seenIds.has(id)) {
    const newId = uuidv4()
    logger.warn(`Duplicate ID ${id}, generated new: ${newId}`)
    return newId
  }
  seenIds.add(id)
  return id
}
```

### Timestamp Normalization
```typescript
function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'number') return new Date(value).toISOString()
  if (typeof value === 'string') return new Date(value).toISOString()
  return new Date().toISOString()
}
```

### Data Merging (Multiple Sources)
```typescript
// Merge Redux metadata with Dexie content (pattern from ChatMigrator)
function mergeTopicData(reduxTopic: ReduxTopic, dexieTopic: DexieTopic): MergedTopic {
  return {
    id: dexieTopic.id,
    name: reduxTopic.name || dexieTopic.name || 'Unnamed',
    messages: dexieTopic.messages,
    assistantId: reduxTopic.assistantId,
    createdAt: reduxTopic.createdAt,
  }
}
```

## Layered Preset Pattern Recognition

When analyzing a Redux slice for migration, check if the data follows the **Layered Preset** pattern — a predefined list of items with user customizations stored per-item. This is common for features with a fixed set of options (tools, providers, templates) where users can override individual settings.

**How to recognize it in Redux:**
- A hardcoded list of items in code (e.g., `CLI_TOOLS`, `PROVIDER_LIST`)
- Per-item user state stored in Redux as `Record<itemId, value>` maps (e.g., `selectedModels: { 'tool-a': Model, 'tool-b': null }`)
- Multiple such maps that share the same item keys

**v2 migration strategy:** Convert to a single `overrides` preference key using delta-only storage:

```typescript
// Before (Redux): Multiple per-tool maps
// codeTools.selectedModels = { 'tool-a': { id: 'm1', ... }, 'tool-b': null }
// codeTools.environmentVariables = { 'tool-a': 'KEY=val', 'tool-b': '' }

// After (v2): Single overrides preference (delta-only, non-default values only)
// preference: 'feature.code_tools.overrides' = { 'tool-a': { modelId: 'm1', envVars: 'KEY=val' } }
```

**Implementation steps:**
1. Define preset types and defaults in `packages/shared/data/presets/<domain>.ts`
2. Add the overrides preference key to `preferenceSchemas.ts` with `{}` as default
3. Use a `ComplexMapping` in `ComplexPreferenceMappings.ts` to merge multiple Redux maps into a single overrides object
4. Write pure transform functions in a separate file (e.g., `CodeToolsTransforms.ts`)

**Key principles:**
- Store only non-default values (delta) — if a tool's settings all match the preset defaults, omit it entirely
- Extract FK IDs from embedded full objects (e.g., `Model` → `modelId`)
- Presets live in code (`packages/shared/data/presets/`), overrides live in preferences

See `docs/en/references/data/best-practice-layered-preset-pattern.md` for full pattern documentation, and `packages/shared/data/presets/code-tools.ts` for a reference implementation.

## Cross-Domain References & Foreign Keys

### The Legacy Problem: Embedded Full Objects

In Redux, domains store **full copies** of objects from other domains instead of just IDs. When the original is deleted, the copy becomes stale — a phantom that the user can't remove.

**Known problematic embeddings:**

| Host | Embedded Guest (full copy) | Field | Stale Data Risk |
|------|---------------------------|-------|-----------------|
| Assistant | `Model` | `model`, `defaultModel` | Model deleted → assistant shows phantom model |
| Assistant | `Topic[]` | `topics` | Topic deleted → assistant still holds copy |
| Assistant | `KnowledgeBase[]` | `knowledge_bases` | KB removed → assistant still references it |
| Assistant | `MCPServer[]` | `mcpServers` | Server removed → assistant still lists it |
| Message | `Model` | `model`, `mentions` | Model removed → stale metadata in history |
| MessageBlock | `Model` | `model` | Same, per-block level |
| LLM store | `Model` (x4) | `defaultModel`, `quickModel`, `translateModel`, `topicNamingModel` | 4 full Model copies go stale |
| WebSearch | `Model` | `compressionConfig.embeddingModel` | Model deleted → RAG compression broken |
| WebSearch | `Model` | `compressionConfig.rerankModel` | Model deleted → reranking broken |

### The v2 Solution: FK IDs Only

The v2 database replaces full-object embeddings with **FK ID references**. The full object can always be fetched via the ID — no need to store redundant copies.

```typescript
// Before (Redux): topic.assistant = { id: 'a1', name: '...', model: {...}, ... }
// After (v2):     topic.assistantId = 'a1'  (query assistant table for full object)

// Before (Redux): message.model = { id: 'm1', name: 'GPT-4', provider: 'openai', ... }
// After (v2):     message.modelId = 'm1'   (query model/provider for full object)
```

### Migration Transform: Full Object → ID

When migrating, extract just the ID from embedded full objects:

```typescript
// Extract ID from full embedded object
function extractId(embedded: any): string | null {
  return embedded?.id ?? null
}

// Usage in a topic transform:
function transformTopic(reduxTopic: any): DbTopicRow {
  return {
    id: reduxTopic.id,
    name: reduxTopic.name,
    assistantId: reduxTopic.assistantId ?? reduxTopic.assistant?.id ?? null,
    // ... other fields
  }
}

// Usage in a message transform:
function transformMessage(msg: any): DbMessageRow {
  return {
    id: msg.id,
    modelId: msg.modelId ?? msg.model?.id ?? null,
    assistantId: msg.assistantId,
    // ... other fields
  }
}
```

### Array References: Full Objects → ID Arrays

For fields that embed arrays of full objects (e.g., `assistant.mcpServers`, `assistant.knowledge_bases`), migrate to arrays of IDs:

```typescript
// Before (Redux): assistant.mcpServers = [{ id: 'srv1', name: '...', url: '...' }, ...]
// After (v2):     assistant.mcpServerIds = ['srv1', 'srv2']  (or a join table)

function extractIds(embedded: any[] | undefined): string[] {
  if (!Array.isArray(embedded)) return []
  return embedded.map(item => item.id).filter(Boolean)
}
```

### Migration Order & Foreign Keys

SQLite enforces FK constraints. Migrators must run in dependency order — referenced tables before referencing tables:

```
order=1  GroupMigrator        → group table (no FKs)
order=2  AssistantMigrator    → assistant table (no FKs to other migrated tables)
order=3  TopicMigrator        → topic table (FK → group, FK → assistant)
order=4  MessageMigrator      → message table (FK → topic, self-ref parentId)
```

**Key rules:**
- **Set `order` so parent tables are populated first** — e.g., topics before messages
- **`MigrationEngine.verifyAndClearNewTables`** must list child tables before parents (reverse order) so DELETE cascades correctly during cleanup
- **Orphan references are expected** — the original entity may have been deleted in Redux while the embedding survived. Set the FK to `null`
- **Share ID maps via `ctx.sharedData`** when a later migrator needs to look up IDs from an earlier one

### Handling Orphan References

When migrating, the embedded object may reference an entity that no longer exists (was deleted by user). The migrator should:

1. **Check if the referenced entity exists** in the already-migrated target table
2. **Set `entityId` to `null` if the FK target doesn't exist** — don't insert a dangling FK

```typescript
async execute(ctx) {
  // Earlier migrator shared the set of valid assistant IDs
  const validAssistantIds = ctx.sharedData.get('assistantIds') as Set<string>

  for (const topic of topics) {
    const row = transformTopic(topic)

    // Validate FK — don't insert dangling reference
    if (row.assistantId && !validAssistantIds.has(row.assistantId)) {
      logger.warn(`Topic ${row.id}: assistant ${row.assistantId} not found, setting to null`)
      row.assistantId = null
    }

    rows.push(row)
  }
}
```

### What to Test (FK-related)

Add these to TDD tests for any migrator that handles cross-domain references:

```typescript
it('should extract ID from full embedded object', () => {
  const embedded = { id: 'm1', name: 'GPT-4', provider: 'openai' }
  expect(extractId(embedded)).toBe('m1')
})

it('should return null for missing embedded object', () => {
  expect(extractId(null)).toBeNull()
  expect(extractId(undefined)).toBeNull()
  expect(extractId({})).toBeNull()
})

it('should set FK to null when referenced entity is deleted', () => {
  const validIds = new Set(['a1'])
  const topic = { id: 't1', assistantId: 'a-deleted', assistant: { id: 'a-deleted', name: 'Old' } }
  const row = transformTopic(topic)
  if (!validIds.has(row.assistantId!)) row.assistantId = null
  expect(row.assistantId).toBeNull()
})

it('should extract ID array from full object array', () => {
  const servers = [{ id: 's1', name: 'MCP1' }, { id: 's2', name: 'MCP2' }]
  expect(extractIds(servers)).toEqual(['s1', 's2'])
  expect(extractIds(undefined)).toEqual([])
  expect(extractIds([])).toEqual([])
})
```

## Error Handling

1. **Never abort for one bad record** - skip it, log warning, increment `skippedCount`
2. **Log with context** - `loggerService.withContext('MigratorName')`
3. **Transaction per batch** - if a batch fails, only that batch rolls back
4. **Provide mismatchReason** - explain count mismatches in `stats.mismatchReason`

```typescript
try {
  rows.push(transformRecord(item))
} catch (err) {
  logger.warn(`Skipping item ${item.id}: ${(err as Error).message}`)
  skippedCount++
}
```

## Checklist

### TDD Cycle (red-green-refactor)
- [ ] Transformation function tests written and **failing** (red) before any implementation
- [ ] Minimum transformation code written to make tests pass (green)
- [ ] Migrator phase tests (prepare/execute/validate) written and **failing** (red)
- [ ] Minimum migrator code written to make phase tests pass (green)
- [ ] Edge case tests: empty data, null fields, duplicate IDs, missing sources
- [ ] Code refactored with all tests still passing
- [ ] Tests pass: `pnpm test:main`

### Implementation details
- [ ] Source data shape understood (Redux slice + Dexie schema)
- [ ] Classification confirmed in `classification.json`
- [ ] Target SQLite schema exists in `src/main/data/db/schemas/`
- [ ] Mapping/transformation file created (if needed)
- [ ] All three phases: prepare, execute, validate
- [ ] Batch inserts + transactions (50-100 per batch)
- [ ] Streaming for large tables (>1000 records)
- [ ] Duplicate ID handling
- [ ] Progress via `reportProgress`
- [ ] Redux slice registered in `ReduxExporter.SLICES_TO_EXPORT` (if reading from Redux)
- [ ] Layered Preset pattern identified and applied (if source has predefined list + per-item overrides)
- [ ] Registered in `migrators/index.ts` with correct `order`
- [ ] Target table added to `MigrationEngine.verifyAndClearNewTables`
- [ ] Cross-migrator data via `ctx.sharedData` (if applicable)
- [ ] `README-<MigratorName>.md` created
- [ ] All logging via `loggerService` (no `console.log`)

### Cross-domain references & FK integrity
- [ ] Embedded full objects → extracted to FK ID only (discard the rest)
- [ ] Array of full objects → array of IDs (or join table)
- [ ] `order` set so parent tables populate before child tables
- [ ] Orphan references handled: FK set to `null`
- [ ] Valid ID sets shared via `ctx.sharedData` for FK validation
- [ ] `verifyAndClearNewTables` lists child tables before parents (reverse delete order)

## Documentation References

- `docs/en/references/data/v2-migration-guide.md` - Migration engine architecture
- `docs/en/references/data/database-patterns.md` - SQLite schema conventions
