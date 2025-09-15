# Cherry Studio Shared Data

This directory contains shared data structures and API type definitions for the Cherry Studio application. It includes both persistent data schemas and API contract definitions.

## 📁 File Organization

### Persistent Data (Root Level)

- **`preferences.ts`** - User preference data schema and default values
- **`preferenceTypes.ts`** - TypeScript types for preference system

### API Types (`api/` subdirectory)

- **`api/index.ts`** - Barrel export file providing clean imports for all API types
- **`api/apiTypes.ts`** - Core request/response types and API infrastructure
- **`api/apiModels.ts`** - Business entity types and Data Transfer Objects (DTOs)
- **`api/apiSchemas.ts`** - Complete API endpoint definitions with type mappings
- **`api/errorCodes.ts`** - Error handling utilities and standardized error codes

## 🏗️ Architecture Overview

These files are part of the **Renderer-Main Virtual Data Acquisition Architecture** that enables:

- **Type-safe IPC communication** between Electron processes
- **RESTful API patterns** within the Electron application
- **Standardized error handling** across the application
- **Future extensibility** to standalone API servers

## 🔄 Classification Status

**Important**: These files are **NOT classified** in the data refactor system because they are:

- ✅ **Type definitions** - Not actual data storage
- ✅ **Compile-time artifacts** - Exist only during TypeScript compilation
- ✅ **Framework infrastructure** - Enable the data API architecture
- ✅ **Development tools** - Similar to interfaces in other languages

## 📖 Usage Examples

### Basic Imports

```typescript
// Import API types from the api subdirectory
import { Topic, CreateTopicDto, DataRequest, ApiSchemas, ErrorCode } from '@shared/data/api'

// Import specific groups
import type { TopicTypes, MessageTypes } from '@shared/data/api'

// Import preferences
import type { UserPreferences } from '@shared/data/preferences'
```

### API Schema Usage

```typescript
import type { ApiSchemas, ApiResponse } from '@shared/data/api'

// Get the response type for a specific endpoint
type TopicsListResponse = ApiResponse<'/topics', 'GET'>
// Result: PaginatedResponse<Topic>

type CreateTopicResponse = ApiResponse<'/topics', 'POST'>
// Result: Topic
```

### Error Handling

```typescript
import { DataApiErrorFactory, ErrorCode, isDataApiError } from '@shared/data/api'

// Create standardized errors
const notFoundError = DataApiErrorFactory.notFound('Topic', '123')
const validationError = DataApiErrorFactory.validation({
  title: ['Title is required']
})

// Check if error is a Data API error
if (isDataApiError(error)) {
  console.log(`Error ${error.code}: ${error.message}`)
}
```

### Request/Response Types

```typescript
import type { DataRequest, DataResponse, PaginatedResponse, Topic } from '@shared/data/api'

// Type-safe request construction
const request: DataRequest = {
  id: 'req_123',
  method: 'GET',
  path: '/topics',
  params: { page: 1, limit: 10 }
}

// Type-safe response handling
const response: DataResponse<PaginatedResponse<Topic>> = {
  id: 'req_123',
  status: 200,
  data: {
    items: [...],
    total: 100,
    page: 1,
    pageCount: 10,
    hasNext: true,
    hasPrev: false
  }
}
```

## 🔧 Development Guidelines

### Adding New Domain Models

1. Add the interface to `api/apiModels.ts`
2. Create corresponding DTOs (Create/Update)
3. Export from `api/index.ts`
4. Update API schemas if needed

```typescript
// In api/apiModels.ts
export interface NewEntity {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface CreateNewEntityDto {
  name: string
}
```

### Adding New API Endpoints

1. Add endpoint definition to `api/apiSchemas.ts`
2. Include JSDoc comments with examples
3. Ensure all types are properly referenced

```typescript
// In api/apiSchemas.ts
export interface ApiSchemas {
  /**
   * New entity endpoint
   * @example GET /entities?page=1&limit=10
   */
  '/entities': {
    /** List all entities */
    GET: {
      query?: PaginationParams
      response: PaginatedResponse<NewEntity>
    }
  }
}
```

### Type Safety Best Practices

- Always use `import type` for type-only imports
- Leverage the type helpers (`ApiResponse`, `ApiParams`, etc.)
- Use the barrel export for clean imports
- Document complex types with JSDoc comments

## 🔗 Related Files

### Main Process Implementation

- `src/main/data/DataApiService.ts` - Main process data service
- `src/main/data/api/` - Controllers, services, and routing

### Renderer Process Implementation

- `src/renderer/src/data/DataApiService.ts` - Renderer API client
- `src/renderer/src/data/hooks/` - React hooks for data fetching

### Shared Data Types

- `packages/shared/data/api/` - API contract definitions
- `packages/shared/data/preferences.ts` - User preference schemas

### Architecture Documentation

- `.claude/data-request-arch.md` - Complete architecture documentation
- `CLAUDE.md` - Project development guidelines

## 🚀 Future Enhancements

The type system is designed to support:

- **HTTP API Server** - Types can be reused for standalone HTTP APIs
- **GraphQL Integration** - Schema can be mapped to GraphQL resolvers
- **Real-time Subscriptions** - WebSocket/SSE event types are defined
- **Advanced Caching** - Cache-related types are ready for implementation

---

_This README is part of the Cherry Studio data refactor project. For more information, see the project documentation in `.claude/` directory._
