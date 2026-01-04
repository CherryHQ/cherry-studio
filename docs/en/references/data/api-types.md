# Data API Type System

This directory contains the type definitions and utilities for Cherry Studio's Data API system, which provides type-safe IPC communication between renderer and main processes.

## Directory Structure

```
packages/shared/data/api/
├── index.ts           # Barrel export for infrastructure types
├── apiTypes.ts        # Core request/response types and API utilities
├── apiPaths.ts        # Path template literal type utilities
├── apiErrors.ts       # Error handling: ErrorCode, DataApiError class, factory
└── schemas/
    ├── index.ts       # Schema composition (merges all domain schemas)
    └── test.ts        # Test API schema and DTOs
```

## File Responsibilities

| File | Purpose |
|------|---------|
| `apiTypes.ts` | Core types (`DataRequest`, `DataResponse`, `ApiClient`) and schema utilities |
| `apiPaths.ts` | Template literal types for path resolution (`/items/:id` → `/items/${string}`) |
| `apiErrors.ts` | `ErrorCode` enum, `DataApiError` class, `DataApiErrorFactory`, retryability config |
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
  // Pagination types
  OffsetPaginationParams,
  OffsetPaginationResponse,
  CursorPaginationParams,
  CursorPaginationResponse,
  PaginationResponse,
  // Query parameter types
  SortParams,
  SearchParams
} from '@shared/data/api'

import {
  ErrorCode,
  DataApiError,
  DataApiErrorFactory,
  isDataApiError,
  toDataApiError,
  // Pagination type guards
  isOffsetPaginationResponse,
  isCursorPaginationResponse
} from '@shared/data/api'
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

## Pagination Types

The API system supports two pagination modes with composable query parameters.

### Request Parameters

| Type | Fields | Use Case |
|------|--------|----------|
| `OffsetPaginationParams` | `page?`, `limit?` | Traditional page-based navigation |
| `CursorPaginationParams` | `cursor?`, `limit?` | Infinite scroll, real-time feeds |
| `SortParams` | `sortBy?`, `sortOrder?` | Sorting (combine as needed) |
| `SearchParams` | `search?` | Text search (combine as needed) |

### Cursor Semantics

The `cursor` in `CursorPaginationParams` marks an **exclusive boundary** - the cursor item itself is never included in the response.

**Common patterns:**

| Pattern | Use Case | Behavior |
|---------|----------|----------|
| "after cursor" | Forward pagination, new items | Returns items AFTER cursor |
| "before cursor" | Backward/historical loading | Returns items BEFORE cursor |

The specific semantic depends on the API endpoint. For example:
- `GET /topics/:id/messages` uses "before cursor" for loading historical messages
- Other endpoints may use "after cursor" for forward pagination

**Example: Loading historical messages**

```typescript
// First request - get most recent messages
const res1 = await api.get('/topics/123/messages', { query: { limit: 20 } })
// res1: { items: [msg80...msg99], nextCursor: 'msg80-id', activeNodeId: '...' }

// Load more - get older messages before the cursor
const res2 = await api.get('/topics/123/messages', {
  query: { cursor: res1.nextCursor, limit: 20 }
})
// res2: { items: [msg60...msg79], nextCursor: 'msg60-id', activeNodeId: '...' }
// Note: msg80 is NOT in res2 (cursor is exclusive)
```

### Response Types

| Type | Fields | Description |
|------|--------|-------------|
| `OffsetPaginationResponse<T>` | `items`, `total`, `page` | Page-based results |
| `CursorPaginationResponse<T>` | `items`, `nextCursor?` | Cursor-based results |
| `PaginationResponse<T>` | Union of both | When either mode is acceptable |

### Usage Examples

```typescript
// Offset pagination with sort and search
query?: OffsetPaginationParams & SortParams & SearchParams & {
  type?: string
}
response: OffsetPaginationResponse<Item>

// Cursor pagination for infinite scroll
query?: CursorPaginationParams & {
  userId: string
}
response: CursorPaginationResponse<Message>
```

### Client-side Calculations

For `OffsetPaginationResponse`, clients can calculate:
```typescript
const pageCount = Math.ceil(total / limit)
const hasNext = page * limit < total
const hasPrev = page > 1
```

For `CursorPaginationResponse`:
```typescript
const hasNext = nextCursor !== undefined
```

## Adding a New Domain Schema

1. Create the schema file (e.g., `schemas/topic.ts`):

```typescript
import type {
  OffsetPaginationParams,
  OffsetPaginationResponse,
  SearchParams,
  SortParams
} from '../apiTypes'

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
      query?: OffsetPaginationParams & SortParams & SearchParams
      response: OffsetPaginationResponse<Topic>  // response is required
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

> **Design Guidelines**: Before creating new schemas, review the [API Design Guidelines](./api-design-guidelines.md) for path naming, HTTP methods, and error handling conventions.

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
const topics = await api.get('/topics', {
  query: { page: 1, limit: 20, search: 'hello' }
})  // Returns OffsetPaginationResponse<Topic>
await api.post('/topics', { body: { name: 'New' } })  // Body is typed as CreateTopicDto
```

## Error Handling

The error system provides type-safe error handling with automatic retryability detection:

```typescript
import {
  DataApiError,
  DataApiErrorFactory,
  ErrorCode,
  isDataApiError,
  toDataApiError
} from '@shared/data/api'

// Create errors using the factory (recommended)
throw DataApiErrorFactory.notFound('Topic', id)
throw DataApiErrorFactory.validation({ name: ['Name is required'] })
throw DataApiErrorFactory.timeout('fetch topics', 3000)
throw DataApiErrorFactory.database(originalError, 'insert topic')

// Or create directly with the class
throw new DataApiError(
  ErrorCode.NOT_FOUND,
  'Topic not found',
  404,
  { resource: 'Topic', id: 'abc123' }
)

// Check if error is retryable (for automatic retry logic)
if (error instanceof DataApiError && error.isRetryable) {
  await retry(operation)
}

// Check error type
if (error instanceof DataApiError) {
  if (error.isClientError) {
    // 4xx - issue with the request
  } else if (error.isServerError) {
    // 5xx - server-side issue
  }
}

// Convert any error to DataApiError
const apiError = toDataApiError(unknownError, 'context')

// Serialize for IPC (Main → Renderer)
const serialized = apiError.toJSON()

// Reconstruct from IPC response (Renderer)
const reconstructed = DataApiError.fromJSON(response.error)
```

### Retryable Error Codes

The following errors are automatically considered retryable:
- `SERVICE_UNAVAILABLE` (503)
- `TIMEOUT` (504)
- `RATE_LIMIT_EXCEEDED` (429)
- `DATABASE_ERROR` (500)
- `INTERNAL_SERVER_ERROR` (500)
- `RESOURCE_LOCKED` (423)

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
