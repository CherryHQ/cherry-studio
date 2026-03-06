# Proto Types Unification — Single Source of Truth

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the proto→JSON conversion layer and make protobuf-generated types the single source of truth for enums and data structures across the entire app.

**Architecture:** Replace the current two-type-system approach (Zod schemas + proto types with conversion layer) with proto types used directly by all consumers. Enums become numeric (proto-native), DB stores numbers, and the `protoModelToJson` conversion layer is deleted. Zod schemas in `provider-catalog` are removed; `packages/shared` defines its own runtime schemas where needed.

**Tech Stack:** `@bufbuild/protobuf` v2, `protoc-gen-es`, Drizzle ORM, Vitest

---

## Background & Motivation

Currently we have:
```
.pb binary → fromBinary() → proto Message → protoModelToJson() → plain JSON → as ModelConfig[]
```

The `protoModelToJson()` conversion maps numeric proto enums to string values (`ModelCapability.FUNCTION_CALL (1)` → `'function_call'`), flattens the reasoning `oneof` structure, and restructures metadata. This creates a parallel type system that must be kept in sync.

**Target state:**
```
.pb binary → fromBinary() → proto Message (used directly everywhere)
```

## Key Design Decisions

1. **Enum representation:** Proto numeric enums everywhere. `ModelCapability.FUNCTION_CALL` (= 1), not `'function_call'`.
2. **DB storage:** JSON columns store numbers for enum arrays (e.g., `[1, 3, 4]` instead of `["function_call", "image_recognition", "image_generation"]`).
3. **Type system:** Proto-generated types (`ModelConfig` from `model_pb.ts`) are canonical. Runtime `Model` type in `packages/shared` uses proto enum types.
4. **Reasoning structure:** Consumers adapt to proto's `oneof` + `common` nesting. The flat Zod discriminated union is removed.
5. **Provider baseUrls:** Map keys stay as `EndpointType` numeric enum values (proto-native `map<int32, string>`).

## Migration Strategy

We migrate **bottom-up** in 4 phases:
1. **Phase 1 (Enum Unification):** Replace const object enums with proto enum re-exports
2. **Phase 2 (Type Unification):** Make `catalog-reader` return proto types directly, update `packages/shared` runtime types
3. **Phase 3 (Consumer Updates):** Update mergeModelConfig, CatalogService, DB schemas
4. **Phase 4 (Cleanup):** Remove Zod schemas, proto-to-json, conversion layer

Each phase is independently committable and testable.

---

## Phase 1: Enum Unification

### Task 1: Replace enum const objects with proto enum re-exports

**Files:**
- Modify: `packages/provider-catalog/src/schemas/enums.ts`
- Modify: `packages/provider-catalog/src/schemas/index.ts`

**Step 1: Update enums.ts to re-export proto enums**

Replace the const object definitions with re-exports from proto-generated code. Keep backward-compatible names via aliases.

```typescript
// packages/provider-catalog/src/schemas/enums.ts

// Re-export proto enums as canonical source of truth
export {
  EndpointType as EndpointType,
  ModelCapability as ModelCapability,
  Modality as Modality,
  Currency as Currency,
  ReasoningEffort as ReasoningEffort
} from '../gen/v1/common_pb'

// Also export the Schema descriptors for enum-to-string conversion if needed
export {
  EndpointTypeSchema as EndpointTypeEnumSchema,
  ModelCapabilitySchema as ModelCapabilityEnumSchema,
  ModalitySchema as ModalityEnumSchema,
  CurrencySchema as CurrencyEnumSchema,
  ReasoningEffortSchema as ReasoningEffortEnumSchema
} from '../gen/v1/common_pb'

// Backward-compatible aliases (const objects → proto enum)
// These allow existing `ENDPOINT_TYPE.CHAT_COMPLETIONS` syntax to keep working
// Values change from strings to numbers — consumers must be updated
import { EndpointType, ModelCapability, Modality } from '../gen/v1/common_pb'

export const ENDPOINT_TYPE = EndpointType
export const MODEL_CAPABILITY = ModelCapability
export const MODALITY = Modality
```

**Step 2: Verify TypeScript compiles**

Run: `cd packages/provider-catalog && npx tsc --noEmit`
Expected: Errors in files that compare enum values to strings — this is expected and will be fixed in subsequent tasks.

**Step 3: Commit**

```
refactor: replace enum const objects with proto enum re-exports
```

### Task 2: Update packages/shared enum re-exports and Model type

**Files:**
- Modify: `packages/shared/data/types/model.ts`
- Modify: `packages/shared/data/types/provider.ts` (if it imports enums)

**Step 1: Update model.ts to use proto enum types**

The `Model` schema currently uses `z.enum(objectValues(MODEL_CAPABILITY))` which relies on string values. Update to accept numeric enum values.

```typescript
// In packages/shared/data/types/model.ts
// Change from:
//   import { ENDPOINT_TYPE, MODALITY, MODEL_CAPABILITY, objectValues } from '@cherrystudio/provider-catalog/schemas'
// To:
import {
  EndpointType,
  Modality,
  ModelCapability,
  ENDPOINT_TYPE,
  MODALITY,
  MODEL_CAPABILITY
} from '@cherrystudio/provider-catalog/schemas'
```

Update `ModelSchema` to use `z.nativeEnum()` instead of `z.enum(objectValues(...))`:

```typescript
capabilities: z.array(z.nativeEnum(ModelCapability)),
inputModalities: z.array(z.nativeEnum(Modality)).optional(),
outputModalities: z.array(z.nativeEnum(Modality)).optional(),
endpointTypes: z.array(z.nativeEnum(EndpointType)).optional(),
```

Update `UI_CAPABILITY_TAGS` to use numeric enum values:
```typescript
export const UI_CAPABILITY_TAGS = [
  ModelCapability.IMAGE_RECOGNITION,
  ModelCapability.IMAGE_GENERATION,
  // ... etc
] as const
```

**Step 2: Update ReasoningConfigSchema**

Change `supportedEfforts` from `z.array(z.enum(['none', ...]))` to `z.array(z.nativeEnum(ReasoningEffort))`:

```typescript
import { ReasoningEffort } from '@cherrystudio/provider-catalog/schemas'

export const ReasoningConfigSchema = z.object({
  type: z.string().regex(/^[a-z][a-z0-9-]*$/),
  thinkingTokenLimits: ThinkingTokenLimitsSchema.optional(),
  supportedEfforts: z.array(z.nativeEnum(ReasoningEffort)).optional(),
  interleaved: z.boolean().optional()
})
```

**Step 3: Verify TypeScript compiles**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: May have errors in consumers — track them for Phase 3.

**Step 4: Commit**

```
refactor: update shared Model type to use proto numeric enums
```

### Task 3: Update DB schema to store numeric enum values

**Files:**
- Modify: `src/main/data/db/schemas/userModel.ts`

**Step 1: Update JSON column types from `string[]` to `number[]`**

```typescript
// Change:
capabilities: text({ mode: 'json' }).$type<string[]>(),
inputModalities: text({ mode: 'json' }).$type<string[]>(),
outputModalities: text({ mode: 'json' }).$type<string[]>(),
endpointTypes: text({ mode: 'json' }).$type<string[]>(),

// To:
capabilities: text({ mode: 'json' }).$type<ModelCapability[]>(),
inputModalities: text({ mode: 'json' }).$type<Modality[]>(),
outputModalities: text({ mode: 'json' }).$type<Modality[]>(),
endpointTypes: text({ mode: 'json' }).$type<EndpointType[]>(),
```

Update `jsonColumnOverrides`:
```typescript
import { EndpointType, Modality, ModelCapability } from '@cherrystudio/provider-catalog'

const jsonColumnOverrides = {
  capabilities: () => z.array(z.nativeEnum(ModelCapability)).nullable(),
  inputModalities: () => z.array(z.nativeEnum(Modality)).nullable(),
  outputModalities: () => z.array(z.nativeEnum(Modality)).nullable(),
  endpointTypes: () => z.array(z.nativeEnum(EndpointType)).nullable(),
  // ... rest unchanged
}
```

**Step 2: Generate migration for the column type change**

Since the column type is `text({ mode: 'json' })`, the actual SQLite column type doesn't change — it's still TEXT. The change is purely in the TypeScript type. No SQL migration needed, but we need a **data migration** to convert existing string values to numbers.

Create a migration script:
```typescript
// Convert stored string enum values to numbers
// e.g., '["function_call","reasoning"]' → '[1,2]'
```

**Step 3: Commit**

```
refactor: update DB schema to use proto numeric enum types
```

---

## Phase 2: Type Unification

### Task 4: Make catalog-reader return proto types directly

**Files:**
- Modify: `packages/provider-catalog/src/catalog-reader.ts`
- Modify: `packages/provider-catalog/src/index.ts`

**Step 1: Remove JSON conversion from catalog-reader**

```typescript
// packages/provider-catalog/src/catalog-reader.ts
import { readFileSync } from 'node:fs'
import { fromBinary } from '@bufbuild/protobuf'
import type { ModelConfig } from './gen/v1/model_pb'
import { ModelCatalogSchema } from './gen/v1/model_pb'
import type { ProviderModelOverride } from './gen/v1/provider_models_pb'
import { ProviderModelCatalogSchema } from './gen/v1/provider_models_pb'
import type { ProviderConfig } from './gen/v1/provider_pb'
import { ProviderCatalogSchema } from './gen/v1/provider_pb'

export function readModelCatalog(pbPath: string): { version: string; models: ModelConfig[] } {
  const bytes = readFileSync(pbPath)
  const catalog = fromBinary(ModelCatalogSchema, new Uint8Array(bytes))
  return { version: catalog.version, models: [...catalog.models] }
}

export function readProviderCatalog(pbPath: string): { version: string; providers: ProviderConfig[] } {
  const bytes = readFileSync(pbPath)
  const catalog = fromBinary(ProviderCatalogSchema, new Uint8Array(bytes))
  return { version: catalog.version, providers: [...catalog.providers] }
}

export function readProviderModelCatalog(pbPath: string): { version: string; overrides: ProviderModelOverride[] } {
  const bytes = readFileSync(pbPath)
  const catalog = fromBinary(ProviderModelCatalogSchema, new Uint8Array(bytes))
  return { version: catalog.version, overrides: [...catalog.overrides] }
}
```

**Step 2: Update index.ts exports**

Export proto types directly alongside catalog-reader functions:

```typescript
// Proto types (source of truth)
export type { ModelConfig, ModelCatalog, ModelPricing, Reasoning } from './gen/v1/model_pb'
export type { ProviderConfig, ProviderCatalog } from './gen/v1/provider_pb'
export type { ProviderModelOverride, ProviderModelCatalog } from './gen/v1/provider_models_pb'

// Proto enum re-exports
export { EndpointType, ModelCapability, Modality, Currency, ReasoningEffort } from './gen/v1/common_pb'

// Catalog reader
export { readModelCatalog, readProviderCatalog, readProviderModelCatalog } from './catalog-reader'
```

**Step 3: Commit**

```
refactor: catalog-reader returns proto types directly, no JSON conversion
```

### Task 5: Update packages/shared ModelConfig and ProviderModelOverride imports

**Files:**
- Modify: `packages/shared/data/utils/modelMerger.ts`
- Modify: any other shared files importing these types

**Step 1: Update modelMerger imports**

Change from importing Zod-inferred types to proto types:

```typescript
import type {
  ModelConfig,
  ProviderConfig,
  ProviderModelOverride,
  Reasoning
} from '@cherrystudio/provider-catalog'
import { EndpointType, ModelCapability, Modality } from '@cherrystudio/provider-catalog'
```

**Step 2: Update merge logic for proto types**

Key changes needed in `mergeModelConfig`:
- Capabilities: work with `ModelCapability[]` (numbers) instead of `string[]`
- Reasoning: handle proto `oneof params` + `common` structure instead of flat discriminated union
- Provider baseUrls: handle `Record<number, string>` keys (proto `map<int32, string>`)
- applyCapabilityOverride: change from `string[]` to `ModelCapability[]`

```typescript
export function applyCapabilityOverride(
  base: ModelCapability[],
  override: { add: ModelCapability[]; remove: ModelCapability[]; force: ModelCapability[] } | null | undefined
): ModelCapability[] {
  if (!override) return [...base]
  if (override.force.length > 0) return [...override.force]
  let result = [...base]
  if (override.add.length) {
    result = Array.from(new Set([...result, ...override.add]))
  }
  if (override.remove.length) {
    const removeSet = new Set(override.remove)
    result = result.filter((c) => !removeSet.has(c))
  }
  return result
}
```

**Step 3: Update reasoning merge logic**

The proto reasoning structure uses `oneof params { case, value }` + `common`. Map this to the runtime `ReasoningConfig` (which still needs a `type` string discriminator for the UI):

```typescript
function extractReasoningType(reasoning: Reasoning): string {
  const caseToType: Record<string, string> = {
    openaiChat: 'openai-chat',
    openaiResponses: 'openai-responses',
    anthropic: 'anthropic',
    gemini: 'gemini',
    openrouter: 'openrouter',
    qwen: 'qwen',
    doubao: 'doubao',
    dashscope: 'dashscope',
    selfHosted: 'self-hosted'
  }
  return caseToType[reasoning.params?.case ?? ''] ?? ''
}
```

**Step 4: Verify tests pass**

Run: `pnpm test`
Expected: Existing tests may need updates — track failures.

**Step 5: Commit**

```
refactor: update modelMerger to work with proto types directly
```

---

## Phase 3: Consumer Updates

### Task 6: Update CatalogService to work with proto types

**Files:**
- Modify: `src/main/data/services/CatalogService.ts`
- Modify: `src/main/data/services/__tests__/CatalogService.test.ts`

**Step 1: Update CatalogService**

The service now receives proto types directly from `readModelCatalog()`. Update the DB row construction to use numeric enum values:

```typescript
dbRows.push({
  providerId,
  modelId: baseModel.id,
  presetModelId: baseModel.id,
  name: merged.name,
  // capabilities is now ModelCapability[] (numbers)
  capabilities: merged.capabilities,
  inputModalities: merged.inputModalities ?? null,
  outputModalities: merged.outputModalities ?? null,
  endpointTypes: merged.endpointTypes ?? null,
  // ... etc
})
```

For `initializePresetProviders`, handle proto's `map<int32, string>` baseUrls:

```typescript
// Proto baseUrls already has EndpointType (number) as keys
baseUrls: Object.fromEntries(
  Object.entries(p.baseUrls).map(([k, v]) => [Number(k), v])
) ?? null,
```

**Step 2: Update tests**

Update test fixtures to use numeric enum values:

```typescript
import { EndpointType, ModelCapability } from '@cherrystudio/provider-catalog'

const preset = makeModelConfig({
  id: 'gpt-4o',
  name: 'GPT-4o',
  capabilities: [ModelCapability.FUNCTION_CALL],
  contextWindow: 128000
})
```

**Step 3: Run tests**

Run: `pnpm test:main`
Expected: PASS

**Step 4: Commit**

```
refactor: update CatalogService to work with proto types
```

### Task 7: Update renderer enum comparisons

**Files:**
- Modify: Files in `src/renderer/` that compare against enum values
- Modify: `src/renderer/src/config/models/reasoning.ts`

**Step 1: Search for all string enum comparisons in renderer**

Find all places that compare against string enum values like `'function_call'`, `'reasoning'`, `'chat_completions'`, etc.

Run: `rg "'function_call'|'reasoning'|'chat_completions'|'image_recognition'" src/renderer/`

**Step 2: Replace string comparisons with proto enum comparisons**

```typescript
// Before:
if (model.capabilities.includes('function_call')) { ... }

// After:
import { ModelCapability } from '@cherrystudio/provider-catalog'
if (model.capabilities.includes(ModelCapability.FUNCTION_CALL)) { ... }
```

**Step 3: Update reasoning effort strings**

```typescript
// Before:
supportedEfforts: ['low', 'medium', 'high']

// After:
import { ReasoningEffort } from '@cherrystudio/provider-catalog'
supportedEfforts: [ReasoningEffort.LOW, ReasoningEffort.MEDIUM, ReasoningEffort.HIGH]
```

**Step 4: Verify TypeScript compiles and tests pass**

Run: `pnpm lint && pnpm test:renderer`

**Step 5: Commit**

```
refactor: update renderer to use proto numeric enums
```

### Task 8: Data migration for existing DB rows

**Files:**
- Create: `src/main/data/migration/v2/migrators/EnumStringToNumberMigrator.ts`

**Step 1: Write migration that converts existing string enum data in SQLite**

For each `user_model` row, parse JSON columns and convert string values to proto enum numbers:

```typescript
const CAPABILITY_STRING_TO_NUMBER: Record<string, number> = {
  'function_call': 1,
  'reasoning': 2,
  'image_recognition': 3,
  // ... all capability values
}

// Similar maps for Modality, EndpointType
```

Read each row, transform JSON arrays, write back.

**Step 2: Write tests for the migration**

**Step 3: Commit**

```
feat: add data migration for string-to-number enum conversion
```

---

## Phase 4: Cleanup

### Task 9: Remove proto-to-json conversion layer

**Files:**
- Delete: `packages/provider-catalog/src/utils/proto-to-json.ts`
- Modify: `packages/provider-catalog/scripts/shared/catalog-io.ts` (remove proto-to-json import)
- Modify: `packages/provider-catalog/src/index.ts` (remove proto-to-json export if any)

**Step 1: Update pipeline scripts catalog-io**

Pipeline scripts also used `protoModelToJson` for reading. Update them to work with proto types directly, or keep the conversion in scripts only (scripts may need JSON for external API compatibility).

Decision: Pipeline scripts deal with external APIs (OpenRouter, models.dev) that use string values. Keep the conversion in `scripts/shared/` only — it's part of the data ingestion pipeline, not the runtime app.

Move `proto-to-json.ts` to `scripts/shared/` (pipeline-only) rather than deleting it.

**Step 2: Commit**

```
refactor: move proto-to-json to pipeline scripts, remove from runtime
```

### Task 10: Remove Zod schemas from provider-catalog

**Files:**
- Delete: `packages/provider-catalog/src/schemas/model.ts`
- Delete: `packages/provider-catalog/src/schemas/provider.ts`
- Delete: `packages/provider-catalog/src/schemas/provider-models.ts`
- Delete: `packages/provider-catalog/src/schemas/common.ts`
- Delete: `packages/provider-catalog/src/schemas/enums.ts`
- Delete: `packages/provider-catalog/src/schemas/index.ts`
- Modify: `packages/provider-catalog/src/index.ts`
- Modify: `packages/provider-catalog/package.json` (remove `schemas` subpath export)

**Step 1: Ensure all external consumers have been migrated**

Verify no file in the monorepo imports from `@cherrystudio/provider-catalog/schemas` except pipeline scripts.

Run: `rg "from '@cherrystudio/provider-catalog/schemas'" --type ts`

**Step 2: Move any still-needed Zod schemas to packages/shared**

Schemas like `ThinkingTokenLimitsSchema`, `ParameterSupportSchema`, `ReasoningConfigSchema` that are used for DB validation should live in `packages/shared/data/types/` — they define runtime shapes, not catalog shapes.

**Step 3: Delete schema files and update exports**

**Step 4: Verify everything compiles and tests pass**

Run: `pnpm build:check`

**Step 5: Commit**

```
refactor: remove Zod schemas from provider-catalog, proto types are source of truth
```

### Task 11: Remove proto-utils enum mapping (if no longer needed)

**Files:**
- Modify or delete: `packages/provider-catalog/src/proto-utils.ts`

**Step 1: Check if runtime code still uses fromCapability/fromEndpointType etc.**

If the only users are pipeline scripts, move these functions to `scripts/shared/`.

**Step 2: Clean up proto-utils**

Keep only `loadBinary` / `saveBinary` if still used. Remove enum mapping functions from the published package.

**Step 3: Commit**

```
refactor: remove enum mapping utils from runtime, keep in pipeline scripts only
```

### Task 12: Final verification

**Step 1: Full build check**

Run: `pnpm build:check`

**Step 2: Run all tests**

Run: `pnpm test`

**Step 3: Verify proto types are the only source of truth**

- No Zod enum schemas in `provider-catalog/src/`
- No `protoModelToJson` in runtime code
- No string enum comparisons in DB or merge logic
- Proto numeric enums used in UI, services, and DB

**Step 4: Commit any final cleanup**

```
chore: final cleanup after proto types unification
```

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| DB data migration fails | Write reversible migration; test on copy first |
| String enum comparisons missed in renderer | Use TypeScript strict mode — type errors will surface |
| Pipeline scripts break | Pipeline scripts keep their own conversion layer |
| Proto type structural differences (reasoning, metadata) | Update consumers incrementally; proto structure is cleaner long-term |
| Name conflicts between proto types and existing types | Use explicit imports, not wildcard re-exports |

## Notes

- **Pipeline scripts** (`packages/provider-catalog/scripts/`) are the data ingestion boundary. They deal with external APIs that use strings, so they keep their own string↔proto conversion. The runtime app does not need this.
- **Reasoning type string** (`'openai-chat'`, `'anthropic'`, etc.) remains as a string in the runtime `ReasoningConfig` type because it's used as a discriminator in the UI. But the `supportedEfforts` array becomes `ReasoningEffort[]` (numbers).
- **Provider baseUrls keys** change from string to number. This is the proto-native representation and is more efficient.
