# Provider Catalog: Protobuf Migration Design

**Date**: 2026-03-06
**Status**: Approved
**Package**: `packages/provider-catalog`

## Background

The provider-catalog package stores template data (models, providers, provider-model overrides) as JSON files in the git repo. This data needs to be shared with another product (Go/Node backend) via object storage (S3/R2).

**Goal**: Migrate from JSON to Protocol Buffers for:
1. Cross-product data sharing (Go + Node both consume the same `.pb` files)
2. Compact binary format (~3-5x smaller than JSON)
3. Strict schema with built-in evolution support

## Architecture

### Approach: Buf + @bufbuild/protobuf (Option C)

Use the `buf` toolchain with `@bufbuild/protobuf` for TypeScript code generation. This provides:
- Unified toolchain for Go and Node
- Type-safe generated TypeScript code
- Schema linting and breaking change detection via `buf lint` / `buf breaking`

### Proto Schema Structure

```
proto/
├── buf.yaml              # buf module config
├── buf.gen.yaml           # code generation config
└── v1/
    ├── common.proto          # Shared types (Pricing, NumericRange, enums)
    ├── model.proto           # ModelConfig, ModelCatalog
    ├── provider.proto        # ProviderConfig, ProviderCatalog
    └── provider_models.proto # ProviderModelOverride, ProviderModelCatalog
```

Package name: `catalog.v1`

### Key Schema Mappings

| Zod (current)                | Proto                                    |
|------------------------------|------------------------------------------|
| `ENDPOINT_TYPE` const object | `enum EndpointType`                      |
| `MODEL_CAPABILITY` const     | `enum ModelCapability`                   |
| `MODALITY` const             | `enum Modality`                          |
| `ModelConfigSchema`          | `message ModelConfig`                    |
| `ProviderConfigSchema`       | `message ProviderConfig`                 |
| `ProviderModelOverrideSchema`| `message ProviderModelOverride`          |
| `NumericRange { min, max }`  | `message NumericRange { double min, max }`|
| `PricePerTokenSchema`        | `message PricePerToken { double per_million_tokens }` |
| Top-level JSON with version  | `message *Catalog { string version, repeated * items }` |

### Data File Changes

**Before:**
```
data/
├── models.json           (~1.6MB)
├── providers.json         (~43KB)
└── provider-models.json   (~1.2MB)
```

**After:**
```
data/
├── models.pb             (~400-500KB estimated)
├── providers.pb
└── provider-models.pb
```

### Build Flow

```
buf generate   →   tsdown build
(proto → TS)       (TS → dist/)
```

Generated TypeScript goes to `src/gen/` (gitignored).

### Package Dependencies

**New runtime:**
- `@bufbuild/protobuf` — serialization/deserialization

**New devDependencies:**
- `@bufbuild/buf` — CLI toolchain
- `@bufbuild/protoc-gen-es` — TypeScript code generation plugin

### Package Scripts

```json
{
  "proto:generate": "buf generate",
  "proto:lint": "buf lint",
  "proto:breaking": "buf breaking --against .git#branch=main",
  "build": "pnpm proto:generate && tsdown",
  "dev": "pnpm proto:generate && tsc --watch"
}
```

### Package Exports

```typescript
// Consumer usage:
import { ModelCatalog, ProviderCatalog } from '@cherrystudio/provider-catalog'

const data = await fetch('https://r2.example.com/catalog/models.pb')
const catalog = ModelCatalog.fromBinary(new Uint8Array(await data.arrayBuffer()))
// Full type hints on catalog.models[0].name, etc.
```

## Migration Strategy

### Scripts

- Internal data processing logic (normalization, merge, parsers) stays unchanged
- Only outer I/O layer changes: `JSON.parse` → `*.fromBinary()`, `JSON.stringify` → `*.toBinary()`
- 14 provider parsers unaffected (they output internal `ProviderModelEntry` objects)
- `src/utils/` (merge-utils, base-transformer) unaffected (operate on in-memory objects)

### New Scripts

- `scripts/migrate-json-to-pb.ts` — one-time migration from existing JSON to .pb
- `scripts/pb-to-json.ts` — optional dev/debug tool to inspect .pb as JSON

### Deletions

- `src/schemas/` — Zod schemas replaced by proto-generated types
- `data/*.json` — replaced by `data/*.pb`

## Reasoning Type Handling

The current discriminated union for reasoning types (8 variants: openai-chat, anthropic, gemini, etc.) will be modeled as a proto `oneof` field within `ModelConfig`.
