# Shared Data Types

This directory contains shared type definitions for Cherry Studio's data layer.

## Documentation

For comprehensive documentation, see:
- **Overview**: [docs/en/references/data/README.md](../../../docs/en/references/data/README.md)
- **Cache Types**: [cache-overview.md](../../../docs/en/references/data/cache-overview.md)
- **Preference Types**: [preference-overview.md](../../../docs/en/references/data/preference-overview.md)
- **API Types**: [api-types.md](../../../docs/en/references/data/api-types.md)

## Directory Structure

```
packages/shared/data/
├── api/                     # Data API type system
│   ├── index.ts             # Barrel exports
│   ├── apiTypes.ts          # Core request/response types
│   ├── apiPaths.ts          # Path template utilities
│   ├── apiErrors.ts         # Error handling
│   └── schemas/             # Domain-specific API schemas
├── cache/                   # Cache system type definitions
│   ├── cacheTypes.ts        # Core cache types
│   ├── cacheSchemas.ts      # Cache key schemas
│   └── cacheValueTypes.ts   # Cache value types
├── preference/              # Preference system type definitions
│   ├── preferenceTypes.ts   # Core preference types
│   └── preferenceSchemas.ts # Preference schemas
└── types/                   # Shared data types
```

## Quick Reference

### Import Conventions

```typescript
// API infrastructure types (from barrel)
import type { DataRequest, DataResponse, ApiClient } from '@shared/data/api'
import { ErrorCode, DataApiError, DataApiErrorFactory } from '@shared/data/api'

// Domain DTOs (from schema files)
import type { Topic, CreateTopicDto } from '@shared/data/api/schemas/topic'

// Cache types
import type { UseCacheKey, UseSharedCacheKey } from '@shared/data/cache'

// Preference types
import type { PreferenceKeyType } from '@shared/data/preference'
```
