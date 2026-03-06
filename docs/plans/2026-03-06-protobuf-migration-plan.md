# Provider Catalog Protobuf Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate `packages/provider-catalog` from JSON + Zod to Protocol Buffers using the Buf toolchain, enabling cross-product data sharing via object storage.

**Architecture:** Proto schemas define all data types in `proto/v1/`. `buf generate` produces TypeScript types into `src/gen/`. Existing Zod schemas are deleted. Data files change from `.json` to `.pb` (binary protobuf). Scripts keep their processing logic but swap I/O from JSON to protobuf.

**Tech Stack:** `@bufbuild/protobuf` (runtime), `@bufbuild/buf` + `@bufbuild/protoc-gen-es` (codegen), `tsdown` (bundling)

---

## Task 1: Install Buf toolchain dependencies

**Files:**
- Modify: `packages/provider-catalog/package.json`

**Step 1: Install dependencies**

Run from repo root:
```bash
cd packages/provider-catalog && pnpm add @bufbuild/protobuf && pnpm add -D @bufbuild/buf @bufbuild/protoc-gen-es
```

**Step 2: Remove Zod from peerDependencies**

In `package.json`, remove `zod` from both `peerDependencies` and `devDependencies`. It will be removed gradually but we stop requiring it now.

> **Note:** Don't remove Zod yet — it's still used by existing code. We'll remove it in Task 8.

**Step 3: Commit**

```bash
git add packages/provider-catalog/package.json pnpm-lock.yaml
git commit -m "feat(provider-catalog): add buf toolchain dependencies"
```

---

## Task 2: Create Buf configuration files

**Files:**
- Create: `packages/provider-catalog/proto/buf.yaml`
- Create: `packages/provider-catalog/proto/buf.gen.yaml`

**Step 1: Create `proto/buf.yaml`**

```yaml
version: v2
modules:
  - path: .
    name: buf.build/cherrystudio/catalog
lint:
  use:
    - STANDARD
breaking:
  use:
    - FILE
```

**Step 2: Create `proto/buf.gen.yaml`**

```yaml
version: v2
inputs:
  - directory: .
plugins:
  - local: protoc-gen-es
    opt: target=ts
    out: ../../src/gen
```

**Step 3: Add `src/gen/` to `.gitignore`**

Append to `packages/provider-catalog/.gitignore` (create if needed):
```
src/gen/
```

**Step 4: Add proto scripts to `package.json`**

Update `scripts` in `packages/provider-catalog/package.json`:
```json
{
  "proto:generate": "buf generate proto",
  "proto:lint": "buf lint proto",
  "proto:breaking": "buf breaking proto --against '../../.git#subdir=packages/provider-catalog/proto,branch=main'",
  "build": "pnpm proto:generate && tsdown",
  "dev": "pnpm proto:generate && tsc -w"
}
```

Keep all existing scripts (`import:*`, `sync:all`, `generate:*`, `pipeline`, `test`, etc.) unchanged.

**Step 5: Commit**

```bash
git add packages/provider-catalog/proto/ packages/provider-catalog/package.json packages/provider-catalog/.gitignore
git commit -m "feat(provider-catalog): add buf configuration files"
```

---

## Task 3: Write `common.proto`

**Files:**
- Create: `packages/provider-catalog/proto/v1/common.proto`

**Step 1: Write the proto file**

```protobuf
syntax = "proto3";
package catalog.v1;

// ═══════════════════════════════════════════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════════════════════════════════════════

enum EndpointType {
  ENDPOINT_TYPE_UNSPECIFIED = 0;
  ENDPOINT_TYPE_CHAT_COMPLETIONS = 1;
  ENDPOINT_TYPE_TEXT_COMPLETIONS = 2;
  ENDPOINT_TYPE_MESSAGES = 3;
  ENDPOINT_TYPE_RESPONSES = 4;
  ENDPOINT_TYPE_GENERATE_CONTENT = 5;
  ENDPOINT_TYPE_OLLAMA_CHAT = 6;
  ENDPOINT_TYPE_OLLAMA_GENERATE = 7;
  ENDPOINT_TYPE_EMBEDDINGS = 8;
  ENDPOINT_TYPE_RERANK = 9;
  ENDPOINT_TYPE_IMAGE_GENERATION = 10;
  ENDPOINT_TYPE_IMAGE_EDIT = 11;
  ENDPOINT_TYPE_AUDIO_TRANSCRIPTION = 12;
  ENDPOINT_TYPE_AUDIO_TRANSLATION = 13;
  ENDPOINT_TYPE_TEXT_TO_SPEECH = 14;
  ENDPOINT_TYPE_VIDEO_GENERATION = 15;
}

enum ModelCapability {
  MODEL_CAPABILITY_UNSPECIFIED = 0;
  MODEL_CAPABILITY_FUNCTION_CALL = 1;
  MODEL_CAPABILITY_REASONING = 2;
  MODEL_CAPABILITY_IMAGE_RECOGNITION = 3;
  MODEL_CAPABILITY_IMAGE_GENERATION = 4;
  MODEL_CAPABILITY_AUDIO_RECOGNITION = 5;
  MODEL_CAPABILITY_AUDIO_GENERATION = 6;
  MODEL_CAPABILITY_EMBEDDING = 7;
  MODEL_CAPABILITY_RERANK = 8;
  MODEL_CAPABILITY_AUDIO_TRANSCRIPT = 9;
  MODEL_CAPABILITY_VIDEO_RECOGNITION = 10;
  MODEL_CAPABILITY_VIDEO_GENERATION = 11;
  MODEL_CAPABILITY_STRUCTURED_OUTPUT = 12;
  MODEL_CAPABILITY_FILE_INPUT = 13;
  MODEL_CAPABILITY_WEB_SEARCH = 14;
  MODEL_CAPABILITY_CODE_EXECUTION = 15;
  MODEL_CAPABILITY_FILE_SEARCH = 16;
  MODEL_CAPABILITY_COMPUTER_USE = 17;
}

enum Modality {
  MODALITY_UNSPECIFIED = 0;
  MODALITY_TEXT = 1;
  MODALITY_IMAGE = 2;
  MODALITY_AUDIO = 3;
  MODALITY_VIDEO = 4;
  MODALITY_VECTOR = 5;
}

enum Currency {
  CURRENCY_UNSPECIFIED = 0; // defaults to USD
  CURRENCY_USD = 1;
  CURRENCY_CNY = 2;
}

enum ReasoningEffort {
  REASONING_EFFORT_UNSPECIFIED = 0;
  REASONING_EFFORT_NONE = 1;
  REASONING_EFFORT_MINIMAL = 2;
  REASONING_EFFORT_LOW = 3;
  REASONING_EFFORT_MEDIUM = 4;
  REASONING_EFFORT_HIGH = 5;
  REASONING_EFFORT_XHIGH = 6;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared Messages
// ═══════════════════════════════════════════════════════════════════════════════

message NumericRange {
  double min = 1;
  double max = 2;
}

message PricePerToken {
  optional double per_million_tokens = 1; // nullable — absent means unknown
  Currency currency = 2;
}

// Generic key-value metadata (replaces Record<string, unknown>)
message Metadata {
  map<string, string> entries = 1;
}
```

**Step 2: Run `buf lint` to verify**

```bash
cd packages/provider-catalog && npx buf lint proto
```

Expected: no errors.

**Step 3: Commit**

```bash
git add packages/provider-catalog/proto/v1/common.proto
git commit -m "feat(provider-catalog): add common.proto with enums and shared types"
```

---

## Task 4: Write `model.proto`

**Files:**
- Create: `packages/provider-catalog/proto/v1/model.proto`

**Step 1: Write the proto file**

```protobuf
syntax = "proto3";
package catalog.v1;

import "v1/common.proto";

// ═══════════════════════════════════════════════════════════════════════════════
// Reasoning Configuration
// ═══════════════════════════════════════════════════════════════════════════════

message ThinkingTokenLimits {
  optional uint32 min = 1;
  optional uint32 max = 2;
  optional uint32 default = 3;
}

// Common fields shared across all reasoning variants
message ReasoningCommon {
  ThinkingTokenLimits thinking_token_limits = 1;
  repeated ReasoningEffort supported_efforts = 2;
  optional bool interleaved = 3;
}

// --- Per-provider reasoning params ---

message OpenAIChatReasoningParams {
  optional ReasoningEffort reasoning_effort = 1;
}

enum ResponsesSummaryMode {
  RESPONSES_SUMMARY_MODE_UNSPECIFIED = 0;
  RESPONSES_SUMMARY_MODE_AUTO = 1;
  RESPONSES_SUMMARY_MODE_CONCISE = 2;
  RESPONSES_SUMMARY_MODE_DETAILED = 3;
}

message OpenAIResponsesReasoningParams {
  optional ReasoningEffort effort = 1;
  optional ResponsesSummaryMode summary = 2;
}

enum AnthropicThinkingType {
  ANTHROPIC_THINKING_TYPE_UNSPECIFIED = 0;
  ANTHROPIC_THINKING_TYPE_ENABLED = 1;
  ANTHROPIC_THINKING_TYPE_DISABLED = 2;
  ANTHROPIC_THINKING_TYPE_ADAPTIVE = 3;
}

message AnthropicReasoningParams {
  optional AnthropicThinkingType type = 1;
  optional uint32 budget_tokens = 2;
  optional ReasoningEffort effort = 3;
}

message GeminiThinkingConfig {
  optional bool include_thoughts = 1;
  optional uint32 thinking_budget = 2;
}

enum GeminiThinkingLevel {
  GEMINI_THINKING_LEVEL_UNSPECIFIED = 0;
  GEMINI_THINKING_LEVEL_MINIMAL = 1;
  GEMINI_THINKING_LEVEL_LOW = 2;
  GEMINI_THINKING_LEVEL_MEDIUM = 3;
  GEMINI_THINKING_LEVEL_HIGH = 4;
}

message GeminiReasoningParams {
  oneof config {
    GeminiThinkingConfig thinking_config = 1;
    GeminiThinkingLevel thinking_level = 2;
  }
}

message OpenRouterReasoningParams {
  optional ReasoningEffort effort = 1;
  optional uint32 max_tokens = 2;
  optional bool exclude = 3;
}

message QwenReasoningParams {
  optional bool enable_thinking = 1;
  optional uint32 thinking_budget = 2;
}

enum DoubaoThinkingType {
  DOUBAO_THINKING_TYPE_UNSPECIFIED = 0;
  DOUBAO_THINKING_TYPE_ENABLED = 1;
  DOUBAO_THINKING_TYPE_DISABLED = 2;
  DOUBAO_THINKING_TYPE_AUTO = 3;
}

message DoubaoReasoningParams {
  optional DoubaoThinkingType thinking_type = 1;
}

message DashscopeReasoningParams {
  optional bool enable_thinking = 1;
  optional bool incremental_output = 2;
}

message SelfHostedReasoningParams {
  optional bool enable_thinking = 1;
  optional bool thinking = 2;
}

// Discriminated union for reasoning configuration
message Reasoning {
  ReasoningCommon common = 1;
  oneof params {
    OpenAIChatReasoningParams openai_chat = 10;
    OpenAIResponsesReasoningParams openai_responses = 11;
    AnthropicReasoningParams anthropic = 12;
    GeminiReasoningParams gemini = 13;
    OpenRouterReasoningParams openrouter = 14;
    QwenReasoningParams qwen = 15;
    DoubaoReasoningParams doubao = 16;
    DashscopeReasoningParams dashscope = 17;
    SelfHostedReasoningParams self_hosted = 18;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Parameter Support
// ═══════════════════════════════════════════════════════════════════════════════

message RangedParameterSupport {
  bool supported = 1;
  optional NumericRange range = 2;
}

message ParameterSupport {
  optional RangedParameterSupport temperature = 1;
  optional RangedParameterSupport top_p = 2;
  optional RangedParameterSupport top_k = 3;
  optional bool frequency_penalty = 4;
  optional bool presence_penalty = 5;
  optional bool max_tokens = 6;
  optional bool stop_sequences = 7;
  optional bool system_message = 8;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pricing
// ═══════════════════════════════════════════════════════════════════════════════

enum ImagePriceUnit {
  IMAGE_PRICE_UNIT_UNSPECIFIED = 0;
  IMAGE_PRICE_UNIT_IMAGE = 1;
  IMAGE_PRICE_UNIT_PIXEL = 2;
}

message ImagePrice {
  double price = 1;
  Currency currency = 2;
  ImagePriceUnit unit = 3;
}

message MinutePrice {
  double price = 1;
  Currency currency = 2;
}

message ModelPricing {
  PricePerToken input = 1;
  PricePerToken output = 2;
  optional PricePerToken cache_read = 3;
  optional PricePerToken cache_write = 4;
  optional ImagePrice per_image = 5;
  optional MinutePrice per_minute = 6;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Model Config
// ═══════════════════════════════════════════════════════════════════════════════

message ModelConfig {
  string id = 1;
  optional string name = 2;
  optional string description = 3;

  repeated ModelCapability capabilities = 4;
  repeated Modality input_modalities = 5;
  repeated Modality output_modalities = 6;

  optional uint32 context_window = 7;
  optional uint32 max_output_tokens = 8;
  optional uint32 max_input_tokens = 9;

  optional ModelPricing pricing = 10;
  optional Reasoning reasoning = 11;
  optional ParameterSupport parameter_support = 12;

  optional string family = 13;
  optional string owned_by = 14;
  optional bool open_weights = 15;

  repeated string alias = 16;
  optional Metadata metadata = 17;
}

// Top-level container
message ModelCatalog {
  string version = 1;
  repeated ModelConfig models = 2;
}
```

**Step 2: Run `buf lint`**

```bash
cd packages/provider-catalog && npx buf lint proto
```

Expected: no errors.

**Step 3: Commit**

```bash
git add packages/provider-catalog/proto/v1/model.proto
git commit -m "feat(provider-catalog): add model.proto with reasoning, pricing, parameter support"
```

---

## Task 5: Write `provider.proto`

**Files:**
- Create: `packages/provider-catalog/proto/v1/provider.proto`

**Step 1: Write the proto file**

```protobuf
syntax = "proto3";
package catalog.v1;

import "v1/common.proto";

// ═══════════════════════════════════════════════════════════════════════════════
// API Compatibility
// ═══════════════════════════════════════════════════════════════════════════════

message ApiCompatibility {
  optional bool array_content = 1;
  optional bool stream_options = 2;
  optional bool developer_role = 3;
  optional bool service_tier = 4;
  optional bool verbosity = 5;
  optional bool enable_thinking = 6;
  optional bool requires_api_key = 7;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Website
// ═══════════════════════════════════════════════════════════════════════════════

message ProviderWebsite {
  optional string official = 1;
  optional string docs = 2;
  optional string api_key = 3;
  optional string models = 4;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Models API URLs
// ═══════════════════════════════════════════════════════════════════════════════

message ModelsApiUrls {
  optional string default = 1;
  optional string embedding = 2;
  optional string reranker = 3;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Config
// ═══════════════════════════════════════════════════════════════════════════════

message ProviderConfig {
  string id = 1;
  string name = 2;
  optional string description = 3;

  // Base URLs keyed by endpoint type
  map<int32, string> base_urls = 4; // key = EndpointType enum value

  optional EndpointType default_chat_endpoint = 5;
  optional ApiCompatibility api_compatibility = 6;
  optional ModelsApiUrls models_api_urls = 7;

  optional Metadata metadata = 8;
  optional ProviderWebsite website = 9;
}

// Top-level container
message ProviderCatalog {
  string version = 1;
  repeated ProviderConfig providers = 2;
}
```

**Step 2: Run `buf lint`**

```bash
cd packages/provider-catalog && npx buf lint proto
```

Expected: no errors.

**Step 3: Commit**

```bash
git add packages/provider-catalog/proto/v1/provider.proto
git commit -m "feat(provider-catalog): add provider.proto"
```

---

## Task 6: Write `provider_models.proto`

**Files:**
- Create: `packages/provider-catalog/proto/v1/provider_models.proto`

**Step 1: Write the proto file**

```protobuf
syntax = "proto3";
package catalog.v1;

import "v1/common.proto";
import "v1/model.proto";

// ═══════════════════════════════════════════════════════════════════════════════
// Capability Override
// ═══════════════════════════════════════════════════════════════════════════════

message CapabilityOverride {
  repeated ModelCapability add = 1;
  repeated ModelCapability remove = 2;
  repeated ModelCapability force = 3;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Model Limits Override
// ═══════════════════════════════════════════════════════════════════════════════

message ModelLimits {
  optional uint32 context_window = 1;
  optional uint32 max_output_tokens = 2;
  optional uint32 max_input_tokens = 3;
  optional uint32 rate_limit = 4;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Model Override
// ═══════════════════════════════════════════════════════════════════════════════

message ProviderModelOverride {
  // Identification
  string provider_id = 1;
  string model_id = 2;
  optional string api_model_id = 3;
  optional string model_variant = 4;

  // Overrides
  optional CapabilityOverride capabilities = 5;
  optional ModelLimits limits = 6;
  optional ModelPricing pricing = 7;
  optional Reasoning reasoning = 8;
  optional ParameterSupport parameter_support = 9;

  repeated EndpointType endpoint_types = 10;
  repeated Modality input_modalities = 11;
  repeated Modality output_modalities = 12;

  // Status
  optional bool disabled = 13;
  optional string replace_with = 14;

  // Metadata
  optional string reason = 15;
  uint32 priority = 16; // 0 = auto, 100+ = manual
}

// Top-level container
message ProviderModelCatalog {
  string version = 1;
  repeated ProviderModelOverride overrides = 2;
}
```

**Step 2: Run `buf lint`**

```bash
cd packages/provider-catalog && npx buf lint proto
```

Expected: no errors.

**Step 3: Commit**

```bash
git add packages/provider-catalog/proto/v1/provider_models.proto
git commit -m "feat(provider-catalog): add provider_models.proto"
```

---

## Task 7: Generate TypeScript code and verify

**Files:**
- Generated (gitignored): `packages/provider-catalog/src/gen/*.ts`

**Step 1: Run code generation**

```bash
cd packages/provider-catalog && npx buf generate proto
```

Expected: files created in `src/gen/`:
- `v1/common_pb.ts`
- `v1/model_pb.ts`
- `v1/provider_pb.ts`
- `v1/provider_models_pb.ts`

**Step 2: Verify the generated code compiles**

```bash
cd packages/provider-catalog && npx tsc --noEmit
```

Expected: no type errors (Zod schemas still exist at this point, so both coexist).

**Step 3: Write a smoke test**

Create `packages/provider-catalog/src/__tests__/protobuf-roundtrip.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { ModelCatalogSchema, ModelConfigSchema } from '../gen/v1/model_pb'
import { ProviderCatalogSchema, ProviderConfigSchema } from '../gen/v1/provider_pb'
import { ProviderModelCatalogSchema } from '../gen/v1/provider_models_pb'

describe('protobuf roundtrip', () => {
  it('ModelCatalog roundtrips through binary', () => {
    const catalog = create(ModelCatalogSchema, {
      version: '2026-03-06',
      models: [
        create(ModelConfigSchema, {
          id: 'claude-3-5-sonnet',
          name: 'Claude 3.5 Sonnet',
          contextWindow: 200000,
          maxOutputTokens: 4096,
        }),
      ],
    })

    const bytes = toBinary(ModelCatalogSchema, catalog)
    const decoded = fromBinary(ModelCatalogSchema, bytes)

    expect(decoded.version).toBe('2026-03-06')
    expect(decoded.models).toHaveLength(1)
    expect(decoded.models[0].id).toBe('claude-3-5-sonnet')
    expect(decoded.models[0].contextWindow).toBe(200000)
  })

  it('ProviderCatalog roundtrips through binary', () => {
    const catalog = create(ProviderCatalogSchema, {
      version: '2026-03-06',
      providers: [
        create(ProviderConfigSchema, {
          id: 'openai',
          name: 'OpenAI',
        }),
      ],
    })

    const bytes = toBinary(ProviderCatalogSchema, catalog)
    const decoded = fromBinary(ProviderCatalogSchema, bytes)

    expect(decoded.providers[0].id).toBe('openai')
  })

  it('ProviderModelCatalog roundtrips through binary', () => {
    const catalog = create(ProviderModelCatalogSchema, {
      version: '2026-03-06',
      overrides: [],
    })

    const bytes = toBinary(ProviderModelCatalogSchema, catalog)
    const decoded = fromBinary(ProviderModelCatalogSchema, bytes)

    expect(decoded.version).toBe('2026-03-06')
    expect(decoded.overrides).toHaveLength(0)
  })
})
```

**Step 4: Run the test**

```bash
cd packages/provider-catalog && pnpm test -- --run src/__tests__/protobuf-roundtrip.test.ts
```

Expected: all 3 tests pass.

> **Note:** The generated schema names follow the `*Schema` suffix convention from `@bufbuild/protobuf` v2. If the generated names differ (e.g. `ModelCatalog` without `Schema`), adjust the imports accordingly.

**Step 5: Commit**

```bash
git add packages/provider-catalog/src/__tests__/protobuf-roundtrip.test.ts
git commit -m "test(provider-catalog): add protobuf roundtrip smoke tests"
```

---

## Task 8: Create JSON-to-Protobuf migration script

**Files:**
- Create: `packages/provider-catalog/scripts/migrate-json-to-pb.ts`

**Step 1: Write the migration script**

This script reads the existing JSON data files, validates them, converts to protobuf messages, and writes `.pb` binary files.

```typescript
/**
 * One-time migration: JSON data files → protobuf binary files
 *
 * Reads: data/models.json, data/providers.json, data/provider-models.json
 * Writes: data/models.pb, data/providers.pb, data/provider-models.pb
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { create, toBinary } from '@bufbuild/protobuf'
import {
  ModelCatalogSchema,
  type ModelConfig,
} from '../src/gen/v1/model_pb'
import {
  ProviderCatalogSchema,
  type ProviderConfig,
} from '../src/gen/v1/provider_pb'
import {
  ProviderModelCatalogSchema,
  type ProviderModelOverride,
} from '../src/gen/v1/provider_models_pb'

// Import enum mappings — these map JSON string values to proto enum numbers
// We'll need to build converter functions for each enum type

const DATA_DIR = resolve(import.meta.dirname, '../data')

// --- Enum string → proto enum converters ---
// (Implement these based on the generated enum values from src/gen/)
// The exact mapping depends on the generated code. The pattern is:
//   JSON 'chat_completions' → EndpointType.CHAT_COMPLETIONS (= 1)
//   JSON 'function_call'    → ModelCapability.FUNCTION_CALL (= 1)
//   JSON 'TEXT'             → Modality.TEXT (= 1)
//   etc.

// --- Main migration logic ---

function migrateModels(): void {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, 'models.json'), 'utf-8'))
  console.log(`Read ${raw.models.length} models from models.json`)

  // TODO: Convert each JSON model object to a ModelConfig protobuf message
  // This requires mapping:
  //   - string enum values to proto enum numbers
  //   - nested objects (pricing, reasoning, parameterSupport) to proto messages
  //   - camelCase field names to snake_case proto fields (handled by protobuf-es)

  const catalog = create(ModelCatalogSchema, {
    version: raw.version,
    models: raw.models.map(convertModelConfig),
  })

  const bytes = toBinary(ModelCatalogSchema, catalog)
  writeFileSync(resolve(DATA_DIR, 'models.pb'), bytes)
  console.log(`Wrote models.pb (${bytes.length} bytes, ${(bytes.length / 1024).toFixed(1)}KB)`)
}

function migrateProviders(): void {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, 'providers.json'), 'utf-8'))
  console.log(`Read ${raw.providers.length} providers from providers.json`)

  const catalog = create(ProviderCatalogSchema, {
    version: raw.version,
    providers: raw.providers.map(convertProviderConfig),
  })

  const bytes = toBinary(ProviderCatalogSchema, catalog)
  writeFileSync(resolve(DATA_DIR, 'providers.pb'), bytes)
  console.log(`Wrote providers.pb (${bytes.length} bytes)`)
}

function migrateProviderModels(): void {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, 'provider-models.json'), 'utf-8'))
  console.log(`Read ${raw.overrides.length} overrides from provider-models.json`)

  const catalog = create(ProviderModelCatalogSchema, {
    version: raw.version,
    overrides: raw.overrides.map(convertProviderModelOverride),
  })

  const bytes = toBinary(ProviderModelCatalogSchema, catalog)
  writeFileSync(resolve(DATA_DIR, 'provider-models.pb'), bytes)
  console.log(`Wrote provider-models.pb (${bytes.length} bytes)`)
}

// --- Converter stubs (implement with actual enum mappings) ---

function convertModelConfig(json: Record<string, unknown>): Partial<ModelConfig> {
  // Map JSON to proto message fields
  // protobuf-es v2 uses camelCase in TS, so field names match mostly
  // Enums need explicit mapping from string → number
  throw new Error('TODO: implement based on generated enum imports')
}

function convertProviderConfig(json: Record<string, unknown>): Partial<ProviderConfig> {
  throw new Error('TODO: implement based on generated enum imports')
}

function convertProviderModelOverride(json: Record<string, unknown>): Partial<ProviderModelOverride> {
  throw new Error('TODO: implement based on generated enum imports')
}

// --- Run ---
console.log('Starting JSON → Protobuf migration...\n')
migrateModels()
migrateProviders()
migrateProviderModels()
console.log('\nMigration complete!')
```

> **Important implementation note:** The converter functions are left as stubs because the exact enum mappings depend on the generated code from Task 7. The implementer must:
> 1. Run `buf generate` first to see the generated enum values
> 2. Import the generated enum objects (e.g., `EndpointType`, `ModelCapability`, `Modality`)
> 3. Build a `string → enum number` mapping for each enum
> 4. Handle nested objects recursively (pricing, reasoning, parameterSupport)

**Step 2: Add the script to package.json**

```json
"migrate:json-to-pb": "tsx scripts/migrate-json-to-pb.ts"
```

**Step 3: Commit**

```bash
git add packages/provider-catalog/scripts/migrate-json-to-pb.ts packages/provider-catalog/package.json
git commit -m "feat(provider-catalog): add JSON-to-protobuf migration script"
```

---

## Task 9: Implement enum mapping utilities and complete migration script

**Files:**
- Create: `packages/provider-catalog/src/proto-utils.ts`
- Modify: `packages/provider-catalog/scripts/migrate-json-to-pb.ts`

**Step 1: Create enum mapping utilities**

After running `buf generate` in Task 7, inspect the generated enums in `src/gen/v1/common_pb.ts` and build bidirectional string↔enum maps.

Create `packages/provider-catalog/src/proto-utils.ts`:

```typescript
/**
 * Utilities for converting between JSON string values and proto enum numbers.
 * Also provides helpers for loading/saving .pb files.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fromBinary, toBinary } from '@bufbuild/protobuf'
import type { DescMessage, MessageShape } from '@bufbuild/protobuf'

// Import generated enums — adjust names based on actual generated code
import {
  EndpointType,
  ModelCapability,
  Modality,
  Currency,
  ReasoningEffort,
} from './gen/v1/common_pb'

// ═══════════════════════════════════════════════════════════════════════════════
// Enum string ↔ proto number mappings
// ═══════════════════════════════════════════════════════════════════════════════

// JSON string → proto enum number
const ENDPOINT_TYPE_MAP: Record<string, number> = {
  chat_completions: EndpointType.CHAT_COMPLETIONS,
  text_completions: EndpointType.TEXT_COMPLETIONS,
  messages: EndpointType.MESSAGES,
  responses: EndpointType.RESPONSES,
  generate_content: EndpointType.GENERATE_CONTENT,
  ollama_chat: EndpointType.OLLAMA_CHAT,
  ollama_generate: EndpointType.OLLAMA_GENERATE,
  embeddings: EndpointType.EMBEDDINGS,
  rerank: EndpointType.RERANK,
  image_generation: EndpointType.IMAGE_GENERATION,
  image_edit: EndpointType.IMAGE_EDIT,
  audio_transcription: EndpointType.AUDIO_TRANSCRIPTION,
  audio_translation: EndpointType.AUDIO_TRANSLATION,
  text_to_speech: EndpointType.TEXT_TO_SPEECH,
  video_generation: EndpointType.VIDEO_GENERATION,
}

const CAPABILITY_MAP: Record<string, number> = {
  function_call: ModelCapability.FUNCTION_CALL,
  reasoning: ModelCapability.REASONING,
  image_recognition: ModelCapability.IMAGE_RECOGNITION,
  image_generation: ModelCapability.IMAGE_GENERATION,
  audio_recognition: ModelCapability.AUDIO_RECOGNITION,
  audio_generation: ModelCapability.AUDIO_GENERATION,
  embedding: ModelCapability.EMBEDDING,
  rerank: ModelCapability.RERANK,
  audio_transcript: ModelCapability.AUDIO_TRANSCRIPT,
  video_recognition: ModelCapability.VIDEO_RECOGNITION,
  video_generation: ModelCapability.VIDEO_GENERATION,
  structured_output: ModelCapability.STRUCTURED_OUTPUT,
  file_input: ModelCapability.FILE_INPUT,
  web_search: ModelCapability.WEB_SEARCH,
  code_execution: ModelCapability.CODE_EXECUTION,
  file_search: ModelCapability.FILE_SEARCH,
  computer_use: ModelCapability.COMPUTER_USE,
}

const MODALITY_MAP: Record<string, number> = {
  TEXT: Modality.TEXT,
  IMAGE: Modality.IMAGE,
  AUDIO: Modality.AUDIO,
  VIDEO: Modality.VIDEO,
  VECTOR: Modality.VECTOR,
}

const CURRENCY_MAP: Record<string, number> = {
  USD: Currency.USD,
  CNY: Currency.CNY,
}

export function toEndpointType(s: string): number {
  return ENDPOINT_TYPE_MAP[s] ?? EndpointType.UNSPECIFIED
}

export function toCapability(s: string): number {
  return CAPABILITY_MAP[s] ?? ModelCapability.UNSPECIFIED
}

export function toModality(s: string): number {
  return MODALITY_MAP[s] ?? Modality.UNSPECIFIED
}

export function toCurrency(s: string | undefined): number {
  if (!s) return Currency.USD
  return CURRENCY_MAP[s] ?? Currency.USD
}

// ═══════════════════════════════════════════════════════════════════════════════
// File I/O helpers
// ═══════════════════════════════════════════════════════════════════════════════

export function loadBinary<T extends DescMessage>(
  schema: T,
  path: string,
): MessageShape<T> {
  const bytes = readFileSync(path)
  return fromBinary(schema, new Uint8Array(bytes))
}

export function saveBinary<T extends DescMessage>(
  schema: T,
  message: MessageShape<T>,
  path: string,
): void {
  const bytes = toBinary(schema, message)
  writeFileSync(path, bytes)
}
```

> **Note:** The exact enum member names (e.g., `EndpointType.CHAT_COMPLETIONS` vs `EndpointType.ENDPOINT_TYPE_CHAT_COMPLETIONS`) depend on the generated code. The implementer must check `src/gen/v1/common_pb.ts` after generation and adjust accordingly.

**Step 2: Complete the migration script converters**

Go back to `scripts/migrate-json-to-pb.ts` and implement the converter functions using the enum mapping utilities. The converters must handle:

- `convertModelConfig`: Map capabilities[], modalities[], pricing (nested PricePerToken), reasoning (discriminated union → oneof), parameterSupport
- `convertProviderConfig`: Map baseUrls (Record<string, url> → map<int32, string>), metadata + website (split into two fields)
- `convertProviderModelOverride`: Map capabilityOverride, limits, pricing, reasoning

**Step 3: Run the migration**

```bash
cd packages/provider-catalog && pnpm migrate:json-to-pb
```

Expected output:
```
Starting JSON → Protobuf migration...

Read 1000+ models from models.json
Wrote models.pb (400-500KB)
Read 50+ providers from providers.json
Wrote providers.pb (~15KB)
Read N overrides from provider-models.json
Wrote provider-models.pb (~300KB)

Migration complete!
```

**Step 4: Write a migration verification test**

Create `packages/provider-catalog/src/__tests__/migration-verify.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fromBinary } from '@bufbuild/protobuf'
import { ModelCatalogSchema } from '../gen/v1/model_pb'
import { ProviderCatalogSchema } from '../gen/v1/provider_pb'
import { ProviderModelCatalogSchema } from '../gen/v1/provider_models_pb'

const DATA_DIR = resolve(import.meta.dirname, '../../data')

describe('migration verification', () => {
  it('models.pb exists and has expected count', () => {
    const path = resolve(DATA_DIR, 'models.pb')
    expect(existsSync(path)).toBe(true)

    const bytes = new Uint8Array(readFileSync(path))
    const catalog = fromBinary(ModelCatalogSchema, bytes)

    expect(catalog.models.length).toBeGreaterThan(1000)
    expect(catalog.version).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('providers.pb exists and has expected count', () => {
    const path = resolve(DATA_DIR, 'providers.pb')
    expect(existsSync(path)).toBe(true)

    const bytes = new Uint8Array(readFileSync(path))
    const catalog = fromBinary(ProviderCatalogSchema, bytes)

    expect(catalog.providers.length).toBeGreaterThan(40)
  })

  it('provider-models.pb exists', () => {
    const path = resolve(DATA_DIR, 'provider-models.pb')
    expect(existsSync(path)).toBe(true)

    const bytes = new Uint8Array(readFileSync(path))
    const catalog = fromBinary(ProviderModelCatalogSchema, bytes)

    expect(catalog.overrides.length).toBeGreaterThan(0)
  })
})
```

**Step 5: Run verification test**

```bash
cd packages/provider-catalog && pnpm test -- --run src/__tests__/migration-verify.test.ts
```

Expected: all 3 tests pass.

**Step 6: Commit**

```bash
git add packages/provider-catalog/src/proto-utils.ts packages/provider-catalog/scripts/migrate-json-to-pb.ts packages/provider-catalog/src/__tests__/migration-verify.test.ts packages/provider-catalog/data/*.pb
git commit -m "feat(provider-catalog): complete JSON-to-protobuf migration with verification"
```

---

## Task 10: Update `src/index.ts` exports

**Files:**
- Modify: `packages/provider-catalog/src/index.ts`
- Modify: `packages/provider-catalog/src/schemas/index.ts`

**Step 1: Update main entry point**

Replace `src/index.ts`:

```typescript
/**
 * Cherry Studio Catalog
 * Main entry point for the model and provider catalog system
 */

// Export generated protobuf types
export * from './gen/v1/common_pb'
export * from './gen/v1/model_pb'
export * from './gen/v1/provider_pb'
export * from './gen/v1/provider_models_pb'

// Export utilities
export * from './proto-utils'

// Re-export legacy enums for backward compatibility during migration
// These const objects map to the same values as the proto enums
export { ENDPOINT_TYPE, MODEL_CAPABILITY, MODALITY } from './schemas/enums'
export type { EndpointType, ModelCapability, Modality } from './schemas/enums'
```

> **Important:** We keep the `enums.ts` re-exports temporarily because consumers (`CatalogService.ts`, `ModelService.ts`, etc.) import `ENDPOINT_TYPE`, `MODEL_CAPABILITY` as const objects. These consumers need to be updated to use proto enums before we can fully remove this.

**Step 2: Verify compilation**

```bash
cd packages/provider-catalog && npx tsc --noEmit
```

Fix any type conflicts between generated types and Zod types. If there are naming collisions, use `as` aliases in the export.

**Step 3: Commit**

```bash
git add packages/provider-catalog/src/index.ts
git commit -m "refactor(provider-catalog): update exports to include protobuf types"
```

---

## Task 11: Update pipeline scripts I/O layer

**Files:**
- Modify: `packages/provider-catalog/scripts/generate-provider-models.ts`
- Modify: `packages/provider-catalog/scripts/generate-providers.ts`
- Modify: `packages/provider-catalog/scripts/populate-reasoning-data.ts`
- Modify: `packages/provider-catalog/scripts/import-openrouter.ts`
- Modify: `packages/provider-catalog/scripts/import-aihubmix.ts`
- Modify: `packages/provider-catalog/scripts/import-modelsdev.ts`

**Strategy:** Each script currently does:
```typescript
const data = JSON.parse(readFileSync('data/models.json', 'utf-8'))
// ... process ...
writeFileSync('data/models.json', JSON.stringify(data, null, 2))
```

Change to:
```typescript
import { fromBinary, toBinary } from '@bufbuild/protobuf'
import { ModelCatalogSchema } from '../src/gen/v1/model_pb'

const bytes = readFileSync('data/models.pb')
const catalog = fromBinary(ModelCatalogSchema, new Uint8Array(bytes))
// ... process catalog.models (same logic) ...
writeFileSync('data/models.pb', toBinary(ModelCatalogSchema, catalog))
```

**Step 1: Update each script's file I/O**

For each script, only change the top-level read/write calls. The internal processing logic (normalization, merge, dedup) stays the same because it operates on in-memory objects. The proto-generated types use camelCase in TypeScript (same as the current JSON), so field access code should remain compatible.

> **Heads-up:** Some scripts may reference Zod schemas for validation (e.g., `ModelListSchema.parse()`). These validation calls should be removed since protobuf handles schema enforcement at serialization time.

**Step 2: Run the pipeline**

```bash
cd packages/provider-catalog && pnpm pipeline
```

Expected: pipeline completes without errors, `.pb` files are updated.

**Step 3: Commit**

```bash
git add packages/provider-catalog/scripts/
git commit -m "refactor(provider-catalog): update pipeline scripts to read/write protobuf"
```

---

## Task 12: Update main app consumers

**Files:**
- Modify: `src/main/data/services/CatalogService.ts`
- Modify: `src/main/data/services/ModelService.ts`
- Modify: `src/main/data/db/schemas/userProvider.ts`
- Modify: `src/main/data/migration/v2/migrators/mappings/ProviderModelMappings.ts`
- Modify: `src/main/data/services/__tests__/CatalogService.test.ts`
- Modify: `src/main/data/migration/v2/migrators/__tests__/ProviderModelMigrator.test.ts`

**Step 1: Update imports**

Replace:
```typescript
import type { ModelConfig, ProviderModelOverride } from '@cherrystudio/provider-catalog'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@cherrystudio/provider-catalog'
```

With proto-generated equivalents. The type names will differ (proto-generated types use the message name directly). The const objects (`ENDPOINT_TYPE`, `MODEL_CAPABILITY`) need to be replaced with proto enum values.

> **Important:** This may require updating enum comparison logic. Currently the code compares string values like `capability === 'function_call'`. With proto enums, it becomes `capability === ModelCapability.FUNCTION_CALL` (number comparison).

**Step 2: Run main app tests**

```bash
pnpm test:main
```

**Step 3: Run full type check**

```bash
pnpm lint
```

**Step 4: Commit**

```bash
git add src/main/
git commit -m "refactor: update main app consumers to use protobuf types"
```

---

## Task 13: Remove Zod schemas and JSON data files

**Files:**
- Delete: `packages/provider-catalog/src/schemas/common.ts`
- Delete: `packages/provider-catalog/src/schemas/model.ts`
- Delete: `packages/provider-catalog/src/schemas/provider.ts`
- Delete: `packages/provider-catalog/src/schemas/provider-models.ts`
- Delete: `packages/provider-catalog/src/schemas/index.ts`
- Keep: `packages/provider-catalog/src/schemas/enums.ts` (still used by consumers for const objects)
- Delete: `packages/provider-catalog/data/models.json`
- Delete: `packages/provider-catalog/data/providers.json`
- Delete: `packages/provider-catalog/data/provider-models.json`

**Step 1: Update `src/index.ts`**

Remove the Zod re-exports, keep only proto exports + enums:

```typescript
export * from './gen/v1/common_pb'
export * from './gen/v1/model_pb'
export * from './gen/v1/provider_pb'
export * from './gen/v1/provider_models_pb'
export * from './proto-utils'

// Legacy const objects for backward compatibility
export { ENDPOINT_TYPE, MODEL_CAPABILITY, MODALITY } from './schemas/enums'
export type { EndpointType, ModelCapability, Modality } from './schemas/enums'
```

**Step 2: Delete the Zod schema files**

```bash
rm packages/provider-catalog/src/schemas/common.ts
rm packages/provider-catalog/src/schemas/model.ts
rm packages/provider-catalog/src/schemas/provider.ts
rm packages/provider-catalog/src/schemas/provider-models.ts
rm packages/provider-catalog/src/schemas/index.ts
```

**Step 3: Delete the JSON data files**

```bash
rm packages/provider-catalog/data/models.json
rm packages/provider-catalog/data/providers.json
rm packages/provider-catalog/data/provider-models.json
```

**Step 4: Remove `zod` from package.json**

Remove `zod` from both `peerDependencies` and `devDependencies`.

**Step 5: Run all tests**

```bash
cd packages/provider-catalog && pnpm test
pnpm test:main
pnpm test:renderer
```

**Step 6: Run build check**

```bash
pnpm build:check
```

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor(provider-catalog): remove Zod schemas and JSON data files"
```

---

## Task 14: Update existing tests

**Files:**
- Modify: `packages/provider-catalog/src/__tests__/base-transformer.test.ts`
- Modify: `packages/provider-catalog/src/__tests__/merge-utils.test.ts`
- Modify: `packages/provider-catalog/src/__tests__/override-cleanup.test.ts`
- Modify: `packages/provider-catalog/src/__tests__/override-generation.test.ts`
- Modify: `packages/provider-catalog/src/__tests__/override-merge.test.ts`
- Modify: `packages/provider-catalog/src/__tests__/providers-config.test.ts`

**Step 1: Update test imports**

Replace any Zod schema imports with proto-generated types. Tests that use `ModelConfigSchema.parse()` for validation should use `create()` + `toBinary()` instead.

**Step 2: Run all provider-catalog tests**

```bash
cd packages/provider-catalog && pnpm test
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add packages/provider-catalog/src/__tests__/
git commit -m "test(provider-catalog): update tests for protobuf types"
```

---

## Task 15: Final verification and cleanup

**Step 1: Run full build check**

```bash
pnpm build:check
```

This runs lint + test + typecheck. Must pass with zero errors.

**Step 2: Run format**

```bash
pnpm format
```

**Step 3: Verify binary sizes**

```bash
ls -la packages/provider-catalog/data/*.pb
```

Report the file sizes to confirm protobuf compression.

**Step 4: Verify the build output**

```bash
cd packages/provider-catalog && pnpm build && ls -la dist/
```

Ensure `dist/index.js`, `dist/index.mjs`, `dist/index.d.ts` are generated correctly.

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore(provider-catalog): final cleanup after protobuf migration"
```

---

## Summary of changes

| Before | After |
|--------|-------|
| Zod schemas in `src/schemas/` | Proto schemas in `proto/v1/` |
| Generated types: none | Generated TS in `src/gen/` (gitignored) |
| Data: `data/*.json` (~2.8MB total) | Data: `data/*.pb` (~800KB estimated) |
| Validation: Zod runtime | Validation: protobuf serialization |
| Deps: `zod` (peer) | Deps: `@bufbuild/protobuf` (runtime) |
| Build: `tsdown` | Build: `buf generate` + `tsdown` |

## Dependencies between tasks

```
Task 1 (deps) → Task 2 (buf config) → Task 3-6 (proto files, parallel) → Task 7 (generate + test)
→ Task 8-9 (migration script) → Task 10 (exports) → Task 11 (scripts) → Task 12 (consumers)
→ Task 13 (cleanup) → Task 14 (tests) → Task 15 (final verify)
```

Tasks 3, 4, 5, 6 can be done in parallel (independent proto files).
Tasks 8 and 9 are sequential (9 completes 8's stubs).
