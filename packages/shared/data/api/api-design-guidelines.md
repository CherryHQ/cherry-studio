# API Design Guidelines

Guidelines for designing RESTful APIs in the Cherry Studio Data API system.

## Path Naming

| Rule | Example | Notes |
|------|---------|-------|
| Use plural nouns for collections | `/topics`, `/messages` | Resources are collections |
| Use kebab-case for multi-word paths | `/user-settings` | Not camelCase or snake_case |
| Express hierarchy via nesting | `/topics/:topicId/messages` | Parent-child relationships |
| Avoid verbs for CRUD operations | `/topics` not `/getTopics` | HTTP methods express action |

## HTTP Method Semantics

| Method | Purpose | Idempotent | Typical Response |
|--------|---------|------------|------------------|
| GET | Retrieve resource(s) | Yes | 200 + data |
| POST | Create resource | No | 201 + created entity |
| PUT | Replace entire resource | Yes | 200 + updated entity |
| PATCH | Partial update | Yes | 200 + updated entity |
| DELETE | Remove resource | Yes | 204 / void |

## Standard Endpoint Patterns

```typescript
// Collection operations
'/topics': {
  GET: { ... }   // List with pagination/filtering
  POST: { ... }  // Create new resource
}

// Individual resource operations
'/topics/:id': {
  GET: { ... }    // Get single resource
  PUT: { ... }    // Replace resource
  PATCH: { ... }  // Partial update
  DELETE: { ... } // Remove resource
}

// Nested resources (use for parent-child relationships)
'/topics/:topicId/messages': {
  GET: { ... }   // List messages under topic
  POST: { ... }  // Create message in topic
}
```

## PATCH vs Dedicated Endpoints

### Decision Criteria

Use this decision tree to determine the appropriate approach:

```
Operation characteristics:
├── Simple field update with no side effects?
│   └── Yes → Use PATCH
├── High-frequency operation with clear business meaning?
│   └── Yes → Use dedicated endpoint (noun-based sub-resource)
├── Operation triggers complex side effects or validation?
│   └── Yes → Use dedicated endpoint
├── Operation creates new resources?
│   └── Yes → Use POST to dedicated endpoint
└── Default → Use PATCH
```

### Guidelines

| Scenario | Approach | Example |
|----------|----------|---------|
| Simple field update | PATCH | `PATCH /messages/:id { data: {...} }` |
| High-frequency + business meaning | Dedicated sub-resource | `PUT /topics/:id/active-node { nodeId }` |
| Complex validation/side effects | Dedicated endpoint | `POST /messages/:id/move { newParentId }` |
| Creates new resources | POST dedicated | `POST /messages/:id/duplicate` |

### Naming for Dedicated Endpoints

- **Prefer noun-based paths** over verb-based when possible
- Treat the operation target as a sub-resource: `/topics/:id/active-node` not `/topics/:id/switch-branch`
- Use POST for actions that create resources or have non-idempotent side effects
- Use PUT for setting/replacing a sub-resource value

### Examples

```typescript
// ✅ Good: Noun-based sub-resource for high-frequency operation
PUT /topics/:id/active-node
{ nodeId: string }

// ✅ Good: Simple field update via PATCH
PATCH /messages/:id
{ data: MessageData }

// ✅ Good: POST for resource creation
POST /messages/:id/duplicate
{ includeDescendants?: boolean }

// ❌ Avoid: Verb in path when noun works
POST /topics/:id/switch-branch  // Use PUT /topics/:id/active-node instead

// ❌ Avoid: Dedicated endpoint for simple updates
POST /messages/:id/update-content  // Use PATCH /messages/:id instead
```

## Non-CRUD Operations

Use verb-based paths for operations that don't fit CRUD semantics:

```typescript
// Search
'/topics/search': {
  GET: { query: { q: string } }
}

// Statistics / Aggregations
'/topics/stats': {
  GET: { response: { total: number, ... } }
}

// Resource actions (state changes, triggers)
'/topics/:id/archive': {
  POST: { response: { archived: boolean } }
}

'/topics/:id/duplicate': {
  POST: { response: Topic }
}
```

## Query Parameters

| Purpose | Pattern | Example |
|---------|---------|---------|
| Pagination | `page` + `limit` | `?page=1&limit=20` |
| Sorting | `orderBy` + `order` | `?orderBy=createdAt&order=desc` |
| Filtering | direct field names | `?status=active&type=chat` |
| Search | `q` or `search` | `?q=keyword` |

## Response Status Codes

Use standard HTTP status codes consistently:

| Status | Usage | Example |
|--------|-------|---------|
| 200 OK | Successful GET/PUT/PATCH | Return updated resource |
| 201 Created | Successful POST | Return created resource |
| 204 No Content | Successful DELETE | No body |
| 400 Bad Request | Invalid request format | Malformed JSON |
| 401 Unauthorized | Authentication required | Missing/invalid token |
| 403 Permission Denied | Insufficient permissions | Access denied to resource |
| 404 Not Found | Resource not found | Invalid ID |
| 409 Conflict | Concurrent modification or data inconsistency | Version conflict, data corruption |
| 422 Unprocessable | Validation failed | Invalid field values |
| 423 Locked | Resource temporarily locked | File being exported |
| 429 Too Many Requests | Rate limit exceeded | Throttling |
| 500 Internal Error | Server error | Unexpected failure |
| 503 Service Unavailable | Service temporarily down | Maintenance mode |
| 504 Timeout | Request timed out | Long-running operation |

## Error Response Format

All error responses follow the `SerializedDataApiError` structure (transmitted via IPC):

```typescript
interface SerializedDataApiError {
  code: ErrorCode | string  // ErrorCode enum value (e.g., 'NOT_FOUND')
  message: string           // Human-readable error message
  status: number            // HTTP status code
  details?: Record<string, unknown>  // Additional context (e.g., field errors)
  requestContext?: {        // Request context for debugging
    requestId: string
    path: string
    method: HttpMethod
    timestamp?: number
  }
  // Note: stack trace is NOT transmitted via IPC - rely on Main process logs
}
```

**Examples:**

```typescript
// 404 Not Found
{
  code: 'NOT_FOUND',
  message: "Topic with id 'abc123' not found",
  status: 404,
  details: { resource: 'Topic', id: 'abc123' },
  requestContext: { requestId: 'req_123', path: '/topics/abc123', method: 'GET' }
}

// 422 Validation Error
{
  code: 'VALIDATION_ERROR',
  message: 'Request validation failed',
  status: 422,
  details: {
    fieldErrors: {
      name: ['Name is required', 'Name must be at least 3 characters'],
      email: ['Invalid email format']
    }
  }
}

// 504 Timeout
{
  code: 'TIMEOUT',
  message: 'Request timeout: fetch topics (3000ms)',
  status: 504,
  details: { operation: 'fetch topics', timeoutMs: 3000 }
}
```

Use `DataApiErrorFactory` utilities to create consistent errors:

```typescript
import { DataApiErrorFactory, DataApiError } from '@shared/data/api'

// Using factory methods (recommended)
throw DataApiErrorFactory.notFound('Topic', id)
throw DataApiErrorFactory.validation({ name: ['Required'] })
throw DataApiErrorFactory.database(error, 'insert topic')
throw DataApiErrorFactory.timeout('fetch topics', 3000)
throw DataApiErrorFactory.dataInconsistent('Topic', 'parent reference broken')

// Check if error is retryable
if (error instanceof DataApiError && error.isRetryable) {
  await retry(operation)
}
```

## Naming Conventions Summary

| Element | Case | Example |
|---------|------|---------|
| Paths | kebab-case, plural | `/user-settings`, `/topics` |
| Path params | camelCase | `:topicId`, `:messageId` |
| Query params | camelCase | `orderBy`, `pageSize` |
| Body fields | camelCase | `createdAt`, `userName` |
| Error codes | SCREAMING_SNAKE | `NOT_FOUND`, `VALIDATION_ERROR` |
