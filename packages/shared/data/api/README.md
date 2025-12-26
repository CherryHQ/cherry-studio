# Data API Type System

This directory contains the type definitions and utilities for Cherry Studio's Data API system, which provides type-safe IPC communication between renderer and main processes.

## Directory Structure

```
packages/shared/data/api/
├── index.ts           # Barrel export for infrastructure types
├── apiTypes.ts        # Core request/response types and API utilities
├── apiPaths.ts        # Path template literal type utilities
├── errorCodes.ts      # Error handling utilities and factories
└── schemas/
    ├── index.ts       # Schema composition (merges all domain schemas)
    └── test.ts        # Test API schema and DTOs
```

## File Responsibilities

| File | Purpose |
|------|---------|
| `apiTypes.ts` | Core types (`DataRequest`, `DataResponse`, `ApiClient`) and schema utilities |
| `apiPaths.ts` | Template literal types for path resolution (`/items/:id` → `/items/${string}`) |
| `errorCodes.ts` | `DataApiErrorFactory`, error codes, and error handling utilities |
| `index.ts` | Unified export of infrastructure types (not domain DTOs) |
| `schemas/index.ts` | Composes all domain schemas into `ApiSchemas` using intersection types |
| `schemas/*.ts` | Domain-specific API definitions and DTOs |

## Import Conventions

### Infrastructure Types (via barrel export)

Use the barrel export for common API infrastructure:

```typescript
import type {
  DataRequest,
  DataResponse,
  ApiClient,
  PaginatedResponse,
  ErrorCode
} from '@shared/data/api'

import { DataApiErrorFactory, isDataApiError } from '@shared/data/api'
```

### Domain DTOs (directly from schema files)

Import domain-specific types directly from their schema files:

```typescript
// Topic domain
import type { Topic, CreateTopicDto, UpdateTopicDto } from '@shared/data/api/schemas/topic'

// Message domain
import type { Message, CreateMessageDto } from '@shared/data/api/schemas/message'

// Test domain (development)
import type { TestItem, CreateTestItemDto } from '@shared/data/api/schemas/test'
```

## Adding a New Domain Schema

1. Create the schema file (e.g., `schemas/topic.ts`):

```typescript
import type { PaginatedResponse } from '../apiTypes'

// Domain models
export interface Topic {
  id: string
  name: string
  createdAt: string
}

export interface CreateTopicDto {
  name: string
}

// API Schema - validation happens via AssertValidSchemas in index.ts
export interface TopicSchemas {
  '/topics': {
    GET: {
      response: PaginatedResponse<Topic>  // response is required
    }
    POST: {
      body: CreateTopicDto
      response: Topic
    }
  }
  '/topics/:id': {
    GET: {
      params: { id: string }
      response: Topic
    }
  }
}
```

**Validation**: Schemas are validated at composition level via `AssertValidSchemas` in `schemas/index.ts`:
- Ensures only valid HTTP methods (GET, POST, PUT, DELETE, PATCH)
- Requires `response` field for each endpoint
- Invalid schemas cause TypeScript errors at the composition point

2. Register in `schemas/index.ts`:

```typescript
import type { TopicSchemas } from './topic'

// AssertValidSchemas provides fallback validation even if ValidateSchema is forgotten
export type ApiSchemas = AssertValidSchemas<TestSchemas & TopicSchemas>
```

3. Implement handlers in `src/main/data/api/handlers/`

## Type Safety Features

### Path Resolution

The system uses template literal types to map concrete paths to schema paths:

```typescript
// Concrete path '/topics/abc123' maps to schema path '/topics/:id'
api.get('/topics/abc123')  // TypeScript knows this returns Topic
```

### Exhaustive Handler Checking

`ApiImplementation` type ensures all schema endpoints have handlers:

```typescript
// TypeScript will error if any endpoint is missing
const handlers: ApiImplementation = {
  '/topics': {
    GET: async () => { /* ... */ },
    POST: async ({ body }) => { /* ... */ }
  }
  // Missing '/topics/:id' would cause compile error
}
```

### Type-Safe Client

`ApiClient` provides fully typed methods:

```typescript
const topic = await api.get('/topics/123')        // Returns Topic
const topics = await api.get('/topics', { query: { page: 1 } })  // Returns PaginatedResponse<Topic>
await api.post('/topics', { body: { name: 'New' } })  // Body is typed as CreateTopicDto
```

## Error Handling

Use `DataApiErrorFactory` for consistent error creation:

```typescript
import { DataApiErrorFactory, ErrorCode } from '@shared/data/api'

// Create errors
throw DataApiErrorFactory.notFound('Topic', id)
throw DataApiErrorFactory.validationError('Name is required')
throw DataApiErrorFactory.fromCode(ErrorCode.DATABASE_ERROR, 'Connection failed')

// Check errors
if (isDataApiError(error)) {
  console.log(error.code, error.status)
}
```

## Architecture Overview

```
Renderer                           Main
────────────────────────────────────────────────────
DataApiService  ──IPC──►  IpcAdapter  ──►  ApiServer
     │                                        │
     │                                        ▼
 ApiClient                              MiddlewareEngine
 (typed)                                      │
                                              ▼
                                         Handlers
                                         (typed)
```

- **Renderer**: Uses `DataApiService` with type-safe `ApiClient` interface
- **IPC**: Requests serialized via `IpcAdapter`
- **Main**: `ApiServer` routes to handlers through `MiddlewareEngine`
- **Type Safety**: End-to-end types from client call to handler implementation
