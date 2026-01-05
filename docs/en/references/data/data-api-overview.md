# DataApi System Overview

The DataApi system provides type-safe IPC communication for business data operations between the Renderer and Main processes.

## Purpose

DataApiService handles data that:
- Is **business data accumulated through user activity**
- Has **dedicated database schemas/tables**
- Users can **create, delete, modify records** without fixed limits
- Would be **severe and irreplaceable** if lost
- Can grow to **large volumes** (potentially GBs)

## Key Characteristics

### Type-Safe Communication
- End-to-end TypeScript types from client call to handler
- Path parameter inference from route definitions
- Compile-time validation of request/response shapes

### RESTful-Style API
- Familiar HTTP semantics (GET, POST, PUT, PATCH, DELETE)
- Resource-based URL patterns (`/topics/:id/messages`)
- Standard status codes and error responses

### On-Demand Data Access
- No automatic caching (fetch fresh data when needed)
- Explicit cache control via query options
- Supports large datasets with pagination

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Renderer Process                                                 │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ React Components                                         │     │
│ │ - useQuery('/topics')                                   │     │
│ │ - useMutation('/topics', 'POST')                        │     │
│ └──────────────────────────┬──────────────────────────────┘     │
│                            ▼                                     │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ DataApiService (Renderer)                               │     │
│ │ - Type-safe ApiClient interface                         │     │
│ │ - Request serialization                                 │     │
│ │ - Automatic retry with exponential backoff              │     │
│ │ - Error handling and transformation                     │     │
│ └──────────────────────────┬──────────────────────────────┘     │
└──────────────────────────────┼───────────────────────────────────┘
                               │ IPC
┌──────────────────────────────┼───────────────────────────────────┐
│ Main Process                 ▼                                   │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ IpcAdapter                                               │     │
│ │ - Receives IPC requests                                  │     │
│ │ - Routes to ApiServer                                    │     │
│ └──────────────────────────┬──────────────────────────────┘     │
│                            ▼                                     │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ ApiServer                                                │     │
│ │ - Request routing by path and method                    │     │
│ │ - Middleware pipeline processing                         │     │
│ └──────────────────────────┬──────────────────────────────┘     │
│                            ▼                                     │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ Handlers (api/handlers/)                                 │     │
│ │ - Thin layer: extract params, call service, transform   │     │
│ │ - NO business logic here                                 │     │
│ └──────────────────────────┬──────────────────────────────┘     │
│                            ▼                                     │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ Services (services/)                                     │     │
│ │ - Business logic and validation                          │     │
│ │ - Transaction coordination                               │     │
│ │ - Domain workflows                                       │     │
│ └──────────────────────────┬──────────────────────────────┘     │
│                            ▼                                     │
│      ┌─────────────────────┴─────────────────────┐              │
│      ▼                                           ▼              │
│ ┌───────────────┐                     ┌─────────────────────┐   │
│ │ Repositories  │                     │ Direct Drizzle      │   │
│ │ (Complex)     │                     │ (Simple domains)    │   │
│ │ - Query logic │                     │ - Inline queries    │   │
│ └───────┬───────┘                     └──────────┬──────────┘   │
│         │                                        │              │
│         └────────────────────┬───────────────────┘              │
│                              ▼                                   │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ SQLite Database (via Drizzle ORM)                       │     │
│ │ - topic, message, file tables                           │     │
│ │ - Full-text search indexes                              │     │
│ └─────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

## Four-Layer Architecture

### 1. API Layer (Handlers)
- **Location**: `src/main/data/api/handlers/`
- **Responsibility**: HTTP-like interface layer
- **Does**: Extract parameters, call services, transform responses
- **Does NOT**: Contain business logic

### 2. Business Logic Layer (Services)
- **Location**: `src/main/data/services/`
- **Responsibility**: Domain logic and workflows
- **Does**: Validation, transaction coordination, orchestration
- **Uses**: Repositories or direct Drizzle queries

### 3. Data Access Layer (Repositories)
- **Location**: `src/main/data/repositories/`
- **Responsibility**: Complex data operations
- **When to use**: Complex queries, large datasets, reusable patterns
- **Alternative**: Direct Drizzle for simple CRUD

### 4. Database Layer
- **Location**: `src/main/data/db/`
- **Technology**: SQLite + Drizzle ORM
- **Schemas**: `db/schemas/` directory

## Data Access Pattern Decision

### Use Repository Pattern When:
- ✅ Complex queries (joins, subqueries, aggregations)
- ✅ GB-scale data requiring optimization and pagination
- ✅ Complex transactions involving multiple tables
- ✅ Reusable data access patterns across services
- ✅ High testing requirements (mock data access)

### Use Direct Drizzle When:
- ✅ Simple CRUD operations
- ✅ Small datasets (< 100MB)
- ✅ Domain-specific queries with no reuse potential
- ✅ Fast development is priority

## Key Features

### Automatic Retry
- Exponential backoff for transient failures
- Configurable retry count and delays
- Skips retry for client errors (4xx)

### Error Handling
- Typed error codes (`ErrorCode` enum)
- `DataApiError` class with retryability detection
- Factory methods for consistent error creation

### Request Timeout
- Configurable per-request timeouts
- Automatic cancellation of stale requests

## Usage Summary

For detailed code examples, see:
- [DataApi in Renderer](./data-api-in-renderer.md) - Client-side usage
- [DataApi in Main](./data-api-in-main.md) - Server-side implementation
- [API Design Guidelines](./api-design-guidelines.md) - RESTful conventions
- [API Types](./api-types.md) - Type system details
