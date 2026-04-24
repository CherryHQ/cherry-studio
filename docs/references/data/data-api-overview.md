# DataApi System Overview

The DataApi system provides type-safe IPC communication for business data operations between the Renderer and Main processes.

## Purpose

DataApiService handles data that:
- Is **business data accumulated through user activity**
- Has **dedicated database schemas/tables**
- Users can **create, delete, modify records** without fixed limits
- Would be **severe and irreplaceable** if lost
- Can grow to **large volumes** (potentially GBs)

## What DataApi is NOT For

DataApi must not be used as a general-purpose RPC layer. The following categories of operations belong in traditional IPC handlers (`src/main/ipc.ts`) or lifecycle services:

- **System control**: Window management, process control, app configuration changes
- **External service integration**: OAuth flows, WebDAV/S3 operations, backup/restore workflows
- **Imperative commands**: Sending notifications, opening URLs, launching external processes
- **Stateless queries without database backing**: System info, font lists, disk space checks

**Why?** DataApi's built-in retry, caching, and layered architecture (Handler → Service → SQLite) are designed for data persistence. These features become harmful or meaningless when applied to side-effectful operations. See [API Design Guidelines — Scope & Boundaries](./api-design-guidelines.md#dataapi-scope--boundaries) for detailed anti-patterns.

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
┌────────────────────────────────────────────────────────────┐
│ Renderer Process                                           │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ React Components                                       │ │
│ │ - useQuery('/topics')                                  │ │
│ │ - useMutation('/topics', 'POST')                       │ │
│ └──────────────────────────┬─────────────────────────────┘ │
│                            ▼                               │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ DataApiService (Renderer)                              │ │
│ │ - Type-safe ApiClient interface                        │ │
│ │ - Request serialization                                │ │
│ │ - Automatic retry with exponential backoff             │ │
│ │ - Error handling and transformation                    │ │
│ └──────────────────────────┬─────────────────────────────┘ │
└────────────────────────────┼───────────────────────────────┘
                             │ IPC
┌────────────────────────────┼───────────────────────────────┐
│ Main Process               ▼                               │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ IpcAdapter                                             │ │
│ │ - Receives IPC requests                                │ │
│ │ - Routes to ApiServer                                  │ │
│ └──────────────────────────┬─────────────────────────────┘ │
│                            ▼                               │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ ApiServer                                              │ │
│ │ - Request routing by path and method                   │ │
│ │ - Middleware pipeline processing                       │ │
│ └──────────────────────────┬─────────────────────────────┘ │
│                            ▼                               │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ Handlers (api/handlers/)                               │ │
│ │ - Thin layer: extract params, call service, transform  │ │
│ │ - NO business logic here                               │ │
│ └──────────────────────────┬─────────────────────────────┘ │
│                            ▼                               │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ Services (services/)                                   │ │
│ │ - Business logic and validation                        │ │
│ │ - Transaction coordination                             │ │
│ │ - Data access via Drizzle ORM                          │ │
│ └──────────────────────────┬─────────────────────────────┘ │
│                            ▼                               │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ SQLite Database (via Drizzle ORM)                      │ │
│ │ - topic, message, file tables                          │ │
│ │ - Full-text search indexes                             │ │
│ └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

## Architecture Layers

### 1. API Layer (Handlers)
- **Location**: `src/main/data/api/handlers/`
- **Responsibility**: HTTP-like interface layer
- **Does**: Extract parameters, call services, transform responses
- **Does NOT**: Contain business logic

### 2. Service Layer (Services)
- **Location**: `src/main/data/services/`
- **Responsibility**: Domain logic, workflows, and data access
- **Does**: Validation, transaction coordination, orchestration, Drizzle ORM queries

> **Note:** In rare cases, a read-only Registry Service (e.g., `ProviderRegistryService`)
> may exist alongside Entity Services to merge preset data with DB data.
> See [DataApi in Main — Registry Services](./data-api-in-main.md#registry-services-supplementary).

### 3. Database Layer
- **Location**: `src/main/data/db/`
- **Technology**: SQLite + Drizzle ORM
- **Schemas**: `db/schemas/` directory

### Repository Pattern (Strongly Discouraged)

> **⚠️ Do NOT create Repository files by default.** Services handle both business logic and data access directly via Drizzle ORM. This is an intentional design decision.
>
> Only create a separate Repository when you are **1000% certain** it is absolutely necessary — e.g., extremely complex multi-table queries with joins/CTEs that would make the Service unreadable, AND the query logic is reused across multiple services.
>
> If in doubt, keep it in the Service. The overhead of an extra architectural layer is not justified for this project's scale (Electron desktop app + SQLite).

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

### Dynamic Paths & Cache Invalidation
- `useQuery` / `useMutation` / `useInfiniteQuery` / `usePaginatedQuery` accept either concrete paths (`/providers/abc`) or template paths with `params` (`/providers/:providerId`)
- `refresh` option supports static paths, `/*` prefix for fan-out, and function form for keys computed from args/result
- Details, patterns, and misuse warnings: see [DataApi in Renderer → Dynamic Paths & Refresh Patterns](./data-api-in-renderer.md#dynamic-paths)

## Usage Summary

For detailed code examples, see:
- [DataApi in Renderer](./data-api-in-renderer.md) - Client-side usage
- [DataApi in Main](./data-api-in-main.md) - Server-side implementation
- [API Design Guidelines](./api-design-guidelines.md) - RESTful conventions
- [API Types](./api-types.md) - Type system details
