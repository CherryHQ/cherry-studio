# Main Data Layer

This directory contains the main process data management system, providing unified data access for the entire application.

## Directory Structure

```
src/main/data/
├── api/                    # Data API framework
│   ├── core/              # Core API infrastructure
│   │   ├── ApiServer.ts   # Request routing and handler execution
│   │   ├── MiddlewareEngine.ts # Request/response middleware
│   │   └── adapters/      # Communication adapters
│   ├── handlers/          # API endpoint implementations
│   ├── services/          # Business logic services
│   └── index.ts          # API framework exports
├── db/                    # Database layer
│   ├── schemas/          # Drizzle table definitions
│   ├── seeding/          # Database initialization
│   └── DbService.ts      # Database connection and management
├── migrate/              # Data migration system
│   └── dataRefactor/     # v2 data refactoring migration tools
├── CacheService.ts       # Main process cache management
├── DataApiService.ts     # Data API coordination service
└── PreferenceService.ts  # User preferences management
```

## Core Services

### CacheService
- **Purpose**: Main process caching with TTL support
- **Features**: Memory cache, IPC synchronization, cross-window broadcasting
- **Usage**: Internal caching for main process services

### PreferenceService
- **Purpose**: Type-safe user configuration management
- **Features**: SQLite persistence, multi-window sync, batch operations
- **Usage**: Managing user settings and application configuration

### DataApiService
- **Purpose**: Coordinates API server and IPC communication
- **Features**: Request routing, error handling, type safety
- **Usage**: Central hub for all data API operations

## Data API Framework

### API Server (`api/core/ApiServer.ts`)
- Request routing and handler execution
- Middleware pipeline processing
- Type-safe endpoint definitions

### Handlers (`api/handlers/`)
- Endpoint implementations for business logic
- Currently contains test handlers (production handlers pending)
- Must implement types defined in `@shared/data/api`

### Services (`api/services/`)
- Business logic layer
- Database operations and data validation
- Called by API handlers

## Database Layer

### DbService
- SQLite database connection management
- Automatic migrations and seeding
- Drizzle ORM integration

### Schemas (`db/schemas/`)
- Table definitions using Drizzle ORM
- Follow naming convention: `{entity}Table` exports
- Use `crudTimestamps` helper for timestamp fields

### Current Tables
- `preference`: User configuration storage
- `appState`: Application state persistence

## Usage Examples

### Accessing Services
```typescript
// Get service instances
import { cacheService } from '@/data/CacheService'
import { preferenceService } from '@/data/PreferenceService'
import { dataApiService } from '@/data/DataApiService'

// Services are singletons, initialized at app startup
```

### Adding New API Endpoints
1. Define endpoint in `@shared/data/api/apiSchemas.ts`
2. Implement handler in `api/handlers/index.ts`
3. Create service in `api/services/` if needed
4. Add database schema in `db/schemas/` if required

### Adding Database Tables
1. Create schema in `db/schemas/{tableName}.ts`
2. Generate migration: `yarn run migrations:generate`
3. Add seeding data in `db/seeding/` if needed
4. Create corresponding service in `api/services/`

## Data Flow

```
Renderer IPC Request
    ↓
DataApiService (coordination)
    ↓
ApiServer (routing)
    ↓
Handler (endpoint logic)
    ↓
Service (business logic)
    ↓
DbService (data persistence)
```

## Development Guidelines

- All services use singleton pattern
- Database operations must be type-safe (Drizzle)
- API endpoints require complete type definitions
- Services should handle errors gracefully
- Use existing logging system (`@logger`)

## Integration Points

- **IPC Communication**: All services expose IPC handlers for renderer communication
- **Type Safety**: Shared types in `@shared/data` ensure end-to-end type safety
- **Error Handling**: Standardized error codes and handling across all services
- **Logging**: Comprehensive logging for debugging and monitoring