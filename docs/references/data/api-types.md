# Data API Type System

This directory contains the type definitions and utilities for Cherry Studio's Data API system, which provides type-safe IPC communication between renderer and main processes.

## Directory Structure

```
src/shared/data/api/
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

## Schema File Organization

Schema files in `schemas/` are organized by the **domain of the entity being operated on or returned**, not by URL prefix. A parent resource in the path (`:topicId`, `:providerId`) only scopes the operation — it does not determine which file the route belongs in.

| Route | Returned entity | Lives in |
|---|---|---|
| `'/topics/:topicId/messages'` | `Message` | `messages.ts` |
| `'/topics/:topicId/tree'` | `Tree` (Message-derived view) | `messages.ts` |
| `'/topics/:id/active-node'` | `ActiveNodeResponse` (Topic state) | `topics.ts` |

When a route's URL parent and returned entity disagree, the entity wins.

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
```

## Pagination Types

The API system supports two pagination modes with composable query parameters.
This section is the **type reference** only — for mode selection (offset vs
cursor), cursor exclusivity semantics, worked examples, and client-side
derivations, see the [Pagination Guide](./data-pagination-guide.md).

### Request Parameters

| Type | Fields | Use Case |
|------|--------|----------|
| `OffsetPaginationParams` | `page?`, `limit?` | Traditional page-based navigation |
| `CursorPaginationParams` | `cursor?`, `limit?` | Infinite scroll, real-time feeds. `cursor` is an exclusive boundary — the cursor item is not returned (see [Pagination Guide](./data-pagination-guide.md#3-wire-contract)) |
| `SortParams` | `sortBy?`, `sortOrder?` | Sorting (combine as needed) |
| `SearchParams` | `search?` | Text search (combine as needed) |

### Response Types

| Type | Fields | Description |
|------|--------|-------------|
| `OffsetPaginationResponse<T>` | `items`, `total`, `page` | Page-based results |
| `CursorPaginationResponse<T>` | `items`, `nextCursor?` | Cursor-based results |
| `PaginationResponse<T>` | Union of both | When either mode is acceptable; narrow with `isOffsetPaginationResponse` / `isCursorPaginationResponse` |

## Adding a New Domain Schema

1. Create the schema file (e.g., `schemas/topic.ts`):

```typescript
import * as z from 'zod'
import type {
  OffsetPaginationParams,
  OffsetPaginationResponse,
  SearchParams,
  SortParams
} from '../apiTypes'

// Field atoms — share between entity, DTO, and query
export const TopicNameSchema = z.string().trim().min(1).max(128)

// Entity schema (z.strictObject rejects unknown fields)
export const TopicSchema = z.strictObject({
  id: z.uuidv4(),
  name: TopicNameSchema,
  createdAt: z.iso.datetime()
})
export type Topic = z.infer<typeof TopicSchema>

// DTO — whitelist pick from entity (see api-design-guidelines.md § Zod Schema & DTO Conventions)
export const CreateTopicSchema = TopicSchema.pick({ name: true })
export type CreateTopicDto = z.infer<typeof CreateTopicSchema>

// API Schema — validation happens via AssertValidSchemas in index.ts
export type TopicSchemas = {
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
export type ApiSchemas = AssertValidSchemas<TopicSchemas & MessageSchemas>
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
