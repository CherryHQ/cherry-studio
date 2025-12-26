# Cherry Studio Shared Data

This directory contains shared type definitions and schemas for the Cherry Studio data management systems. These files provide type safety and consistency across the entire application.

## Directory Structure

```
packages/shared/data/
├── api/                     # Data API type system (see api/README.md)
│   ├── index.ts             # Barrel exports for infrastructure types
│   ├── apiTypes.ts          # Core request/response types and utilities
│   ├── apiPaths.ts          # Path template literal type utilities
│   ├── errorCodes.ts        # Error handling utilities
│   ├── schemas/             # Domain-specific API schemas
│   │   ├── index.ts         # Schema composition
│   │   ├── test.ts          # Test API schema and DTOs
│   │   └── batch.ts         # Batch/transaction operations
│   └── README.md            # Detailed API documentation
├── cache/                   # Cache system type definitions
│   ├── cacheTypes.ts        # Core cache infrastructure types
│   ├── cacheSchemas.ts      # Cache key schemas and type mappings
│   └── cacheValueTypes.ts   # Cache value type definitions
├── preference/              # Preference system type definitions
│   ├── preferenceTypes.ts   # Core preference system types
│   └── preferenceSchemas.ts # Preference schemas and default values
├── types/                   # Shared data types for Main/Renderer
└── README.md                # This file
```

## System Overview

This directory provides type definitions for four main data management systems:

### Types System (`types/`)
- **Purpose**: Shared data types for cross-process (Main/Renderer) communication and database schemas
- **Features**: Database table field types, business entity definitions
- **Usage**: Used in Drizzle ORM schemas via `.$type<T>()` and runtime type checking

### API System (`api/`)
- **Purpose**: Type-safe IPC communication between Main and Renderer processes
- **Features**: RESTful patterns, modular schema design, error handling
- **Documentation**: See [`api/README.md`](./api/README.md) for detailed usage

### Cache System (`cache/`)
- **Purpose**: Type definitions for three-layer caching architecture
- **Features**: Memory/shared/persist cache schemas, TTL support, hook integration
- **Usage**: Type-safe caching operations across the application

### Preference System (`preference/`)
- **Purpose**: User configuration and settings management
- **Features**: 158 configuration items, default values, nested key support
- **Usage**: Type-safe preference access and synchronization

## File Categories

**Framework Infrastructure** - These are TypeScript type definitions that:
- ✅ Exist only at compile time
- ✅ Provide type safety and IntelliSense support
- ✅ Define contracts between application layers
- ✅ Enable static analysis and error detection

## Usage Examples

### API Types
```typescript
// Infrastructure types from barrel export
import type { DataRequest, DataResponse, ApiClient } from '@shared/data/api'
import { DataApiErrorFactory, ErrorCode } from '@shared/data/api'

// Domain DTOs directly from schema files
import type { TestItem, CreateTestItemDto } from '@shared/data/api/schemas/test'
```

### Cache Types
```typescript
// Import cache types
import type { UseCacheKey, UseSharedCacheKey } from '@shared/data/cache'
```

### Preference Types
```typescript
// Import preference types
import type { PreferenceKeyType, PreferenceDefaultScopeType } from '@shared/data/preference'
```

## Development Guidelines

### Adding Shared Types
1. Create or update type file in `types/` directory
2. Use camelCase for field names
3. Reference types in Drizzle schemas using `.$type<T>()`

### Adding Cache Types
1. Add cache key to `cache/cacheSchemas.ts`
2. Define value type in `cache/cacheValueTypes.ts`
3. Update type mappings for type safety

### Adding Preference Types
1. Add preference key to `preference/preferenceSchemas.ts`
2. Define default value and type
3. Preference system automatically picks up new keys

### Adding API Types
1. Create schema file in `api/schemas/` (e.g., `topic.ts`)
2. Define domain models, DTOs, and API schema in the file
3. Register schema in `api/schemas/index.ts` using intersection type
4. See [`api/README.md`](./api/README.md) for detailed guide

### Best Practices
- Use `import type` for type-only imports
- Infrastructure types from barrel, domain DTOs from schema files
- Follow existing naming conventions
- Document complex types with JSDoc

## Related Implementation

### Main Process
- `src/main/data/api/` - API server, handlers, and IPC adapter
- `src/main/data/cache/` - Cache service implementation
- `src/main/data/preference/` - Preference service implementation

### Renderer Process
- `src/renderer/src/services/DataApiService.ts` - API client
- `src/renderer/src/services/CacheService.ts` - Cache service
- `src/renderer/src/services/PreferenceService.ts` - Preference service