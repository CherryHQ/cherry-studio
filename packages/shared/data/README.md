# Cherry Studio Shared Data

This directory contains shared type definitions and schemas for the Cherry Studio data management systems. These files provide type safety and consistency across the entire application.

## 📁 Directory Structure

```
packages/shared/data/
├── api/                     # Data API type system
│   ├── index.ts            # Barrel exports for clean imports
│   ├── apiSchemas.ts       # API endpoint definitions and mappings
│   ├── apiTypes.ts         # Core request/response infrastructure types
│   ├── apiModels.ts        # Business entity types and DTOs
│   ├── apiPaths.ts         # API path definitions and utilities
│   └── errorCodes.ts       # Standardized error handling
├── cache/                   # Cache system type definitions
│   ├── cacheTypes.ts       # Core cache infrastructure types
│   ├── cacheSchemas.ts     # Cache key schemas and type mappings
│   └── cacheValueTypes.ts  # Cache value type definitions
├── preference/              # Preference system type definitions
│   ├── preferenceTypes.ts  # Core preference system types
│   └── preferenceSchemas.ts # Preference schemas and default values
└── README.md               # This file
```

## 🏗️ System Overview

This directory provides type definitions for three main data management systems:

### API System (`api/`)
- **Purpose**: Type-safe IPC communication between Main and Renderer processes
- **Features**: RESTful patterns, error handling, business entity definitions
- **Usage**: Ensures type safety for all data API operations

### Cache System (`cache/`)
- **Purpose**: Type definitions for three-layer caching architecture
- **Features**: Memory/shared/persist cache schemas, TTL support, hook integration
- **Usage**: Type-safe caching operations across the application

### Preference System (`preference/`)
- **Purpose**: User configuration and settings management
- **Features**: 158 configuration items, default values, nested key support
- **Usage**: Type-safe preference access and synchronization

## 📋 File Categories

**Framework Infrastructure** - These are TypeScript type definitions that:
- ✅ Exist only at compile time
- ✅ Provide type safety and IntelliSense support
- ✅ Define contracts between application layers
- ✅ Enable static analysis and error detection

## 📖 Usage Examples

### API Types
```typescript
// Import API types
import type { DataRequest, DataResponse, ApiSchemas } from '@shared/data/api'
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

## 🔧 Development Guidelines

### Adding Cache Types
1. Add cache key to `cache/cacheSchemas.ts`
2. Define value type in `cache/cacheValueTypes.ts`
3. Update type mappings for type safety

### Adding Preference Types
1. Add preference key to `preference/preferenceSchemas.ts`
2. Define default value and type
3. Preference system automatically picks up new keys

### Adding API Types
1. Define business entities in `api/apiModels.ts`
2. Add endpoint definitions to `api/apiSchemas.ts`
3. Export types from `api/index.ts`

### Best Practices
- Use `import type` for type-only imports
- Follow existing naming conventions
- Document complex types with JSDoc
- Maintain type safety across all imports

## 🔗 Related Implementation

### Main Process Services
- `src/main/data/CacheService.ts` - Main process cache management
- `src/main/data/PreferenceService.ts` - Preference management service
- `src/main/data/DataApiService.ts` - Data API coordination service

### Renderer Process Services
- `src/renderer/src/data/CacheService.ts` - Renderer cache service
- `src/renderer/src/data/PreferenceService.ts` - Renderer preference service
- `src/renderer/src/data/DataApiService.ts` - Renderer API client