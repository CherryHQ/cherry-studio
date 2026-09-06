# Shared Data Types

This directory contains shared type definitions for Cherry Studio's data layer.

## Documentation

For comprehensive documentation, see:
- **Overview**: [docs/references/data/README.md](../../../docs/references/data/README.md)
- **Cache Types**: [cache-overview.md](../../../docs/references/data/cache-overview.md) — schemas in `cache/cacheSchemas.ts`, template matcher in `cache/templateKey.ts`; adding keys: [cache-schema-guide.md](../../../docs/references/data/cache-schema-guide.md)
- **Preference Types**: [preference-overview.md](../../../docs/references/data/preference-overview.md)
- **API Types**: [api-types.md](../../../docs/references/data/api-types.md)

## Directory Structure

```
src/shared/data/
├── api/                     # Data API type system
│   ├── types.ts             # Core request/response and pagination types
│   ├── paths.ts             # Path template utilities
│   ├── errors.ts            # Error handling
│   └── schemas/             # Domain-specific API schemas
├── bootConfig/              # Boot config schemas and key types
├── cache/                   # Cache system type definitions
│   ├── cacheTypes.ts        # Core cache types
│   ├── cacheSchemas.ts      # Cache key schemas
│   └── cacheValueTypes.ts   # Cache value types
├── migration/               # Cross-process v2 migration result/progress types
├── preference/              # Preference system type definitions
│   ├── preferenceTypes.ts   # Core preference types
│   └── preferenceSchemas.ts # Preference schemas
├── presets/                 # App-owned preset catalogs
└── types/                   # Shared data types
```

## Quick Reference

### Import Conventions

```typescript
// API infrastructure types (direct modules; api/ has no barrel)
import type { DataRequest, DataResponse, ApiClient } from '@shared/data/api/types'
import { ErrorCode, DataApiError, DataApiErrorFactory } from '@shared/data/api/errors'

// Domain DTOs (from schema files)
import type { CreateTopicDto } from '@shared/data/api/schemas/topics'
import type { Topic } from '@shared/data/types/topic'

// Cache types
import type { SharedCacheKey, UseCacheKey } from '@shared/data/cache/cacheSchemas'

// Preference types
import type { PreferenceKeyType } from '@shared/data/preference/preferenceTypes'
```
