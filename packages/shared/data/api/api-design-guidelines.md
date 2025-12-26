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
| 403 Forbidden | Permission denied | Insufficient access |
| 404 Not Found | Resource not found | Invalid ID |
| 409 Conflict | Concurrent modification | Version conflict |
| 422 Unprocessable | Validation failed | Invalid field values |
| 429 Too Many Requests | Rate limit exceeded | Throttling |
| 500 Internal Error | Server error | Unexpected failure |

## Error Response Format

All error responses follow the `DataApiError` structure:

```typescript
interface DataApiError {
  code: string      // ErrorCode enum value (e.g., 'NOT_FOUND')
  message: string   // Human-readable error message
  status: number    // HTTP status code
  details?: any     // Additional context (e.g., field errors)
  stack?: string    // Stack trace (development only)
}
```

**Examples:**

```typescript
// 404 Not Found
{
  code: 'NOT_FOUND',
  message: "Topic with id 'abc123' not found",
  status: 404,
  details: { resource: 'Topic', id: 'abc123' }
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
```

Use `DataApiErrorFactory` utilities to create consistent errors:

```typescript
import { DataApiErrorFactory } from '@shared/data/api'

throw DataApiErrorFactory.notFound('Topic', id)
throw DataApiErrorFactory.validation({ name: ['Required'] })
throw DataApiErrorFactory.database(error, 'insert topic')
```

## Naming Conventions Summary

| Element | Case | Example |
|---------|------|---------|
| Paths | kebab-case, plural | `/user-settings`, `/topics` |
| Path params | camelCase | `:topicId`, `:messageId` |
| Query params | camelCase | `orderBy`, `pageSize` |
| Body fields | camelCase | `createdAt`, `userName` |
| Error codes | SCREAMING_SNAKE | `NOT_FOUND`, `VALIDATION_ERROR` |
