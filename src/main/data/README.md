# Main Data Layer

This directory contains the main process data management system, providing unified data access for the entire application.

## Directory Structure

```
src/main/data/
├── api/                       # Data API framework (interface layer)
│   ├── core/                  # Core API infrastructure
│   │   ├── ApiServer.ts       # Request routing and handler execution
│   │   ├── MiddlewareEngine.ts # Request/response middleware
│   │   └── adapters/          # Communication adapters (IPC)
│   ├── handlers/              # API endpoint implementations
│   │   └── index.ts          # Thin handlers: param extraction, DTO conversion
│   └── index.ts              # API framework exports
│
├── services/                  # Business logic layer
│   ├── base/                 # Service base classes and interfaces
│   │   └── IBaseService.ts   # Service interface definitions
│   └── TestService.ts        # Test service (placeholder for real services)
│   # Future business services:
│   # - TopicService.ts      # Topic business logic
│   # - MessageService.ts    # Message business logic
│   # - FileService.ts       # File business logic
│
├── repositories/              # Data access layer (selective usage)
│   # Repository pattern used selectively for complex domains
│   # Future repositories:
│   # - TopicRepository.ts   # Complex: Topic data access
│   # - MessageRepository.ts # Complex: Message data access
│
├── db/                       # Database layer
│   ├── schemas/              # Drizzle table definitions
│   │   ├── preference.ts     # Preference configuration table
│   │   ├── appState.ts       # Application state table
│   │   └── columnHelpers.ts  # Reusable column definitions
│   ├── seeding/              # Database initialization
│   └── DbService.ts          # Database connection and management
│
├── migration/                # Data migration system
│   └── v2/                   # v2 data refactoring migration tools
│
├── CacheService.ts           # Infrastructure: Cache management
├── DataApiService.ts         # Infrastructure: API coordination
└── PreferenceService.ts      # System service: User preferences
```

## Core Components

### Naming Note

Three components at the root of `data/` use the "Service" suffix but serve different purposes:

#### CacheService (Infrastructure Component)
- **True Nature**: Cache Manager / Infrastructure Utility
- **Purpose**: Multi-tier caching system (memory/shared/persist)
- **Features**: TTL support, IPC synchronization, cross-window broadcasting
- **Characteristics**: Zero business logic, purely technical functionality
- **Note**: Named "Service" for management consistency, but is actually infrastructure

#### DataApiService (Coordinator Component)
- **True Nature**: API Coordinator (Main) / API Client (Renderer)
- **Main Process Purpose**: Coordinates ApiServer and IpcAdapter initialization
- **Renderer Purpose**: HTTP-like client for IPC communication
- **Characteristics**: Zero business logic, purely coordination/communication plumbing
- **Note**: Named "Service" for management consistency, but is actually coordinator/client

#### PreferenceService (System Service)
- **True Nature**: System-level Data Access Service
- **Purpose**: User configuration management with caching and multi-window sync
- **Features**: SQLite persistence, full memory cache, cross-window synchronization
- **Characteristics**: Minimal business logic (validation, defaults), primarily data access
- **Note**: Hybrid between data access and infrastructure, "Service" naming is acceptable

**Key Takeaway**: Despite all being named "Service", these are infrastructure/coordination components, not business services. The "Service" suffix is kept for consistency with existing codebase conventions.

## Architecture Layers

### API Framework Layer (`api/`)

The API framework provides the interface layer for data access:

#### API Server (`api/core/ApiServer.ts`)
- Request routing and handler execution
- Middleware pipeline processing
- Type-safe endpoint definitions

#### Handlers (`api/handlers/`)
- **Purpose**: Thin API endpoint implementations
- **Responsibilities**:
  - HTTP-like parameter extraction from requests
  - DTO/domain model conversion
  - Delegating to business services
  - Transforming responses for IPC
- **Anti-pattern**: Do NOT put business logic in handlers
- **Currently**: Contains test handlers (production handlers pending)
- **Type Safety**: Must implement all endpoints defined in `@shared/data/api`

### Business Logic Layer (`services/`)

Business services implement domain logic and workflows:

#### When to Create a Service
- Contains business rules and validation
- Orchestrates multiple repositories or data sources
- Implements complex workflows
- Manages transactions across multiple operations

#### Service Pattern

Just an example for understanding.

```typescript
// services/TopicService.ts
export class TopicService {
  constructor(
    private topicRepo: TopicRepository,    // Use repository for complex data access
    private cacheService: CacheService     // Use infrastructure utilities
  ) {}

  async createTopicWithMessage(data: CreateTopicDto) {
    // Business validation
    this.validateTopicData(data)

    // Transaction coordination
    return await DbService.transaction(async (tx) => {
      const topic = await this.topicRepo.create(data.topic, tx)
      const message = await this.messageRepo.create(data.message, tx)
      return { topic, message }
    })
  }
}
```

#### Current Services
- `TestService`: Placeholder service for testing API framework
- More business services will be added as needed (TopicService, MessageService, etc.)

### Data Access Layer (`repositories/`)

Repositories handle database operations with a **selective usage pattern**:

#### When to Use Repository Pattern
Use repositories for **complex domains** that meet multiple criteria:
- ✅ Complex queries (joins, subqueries, aggregations)
- ✅ GB-scale data requiring optimization and pagination
- ✅ Complex transactions involving multiple tables
- ✅ Reusable data access patterns across services
- ✅ High testing requirements (mock data access in tests)

#### When to Use Direct Drizzle in Services
Skip repository layer for **simple domains**:
- ✅ Simple CRUD operations
- ✅ Small datasets (< 100MB)
- ✅ Domain-specific queries with no reuse potential
- ✅ Fast development is priority

#### Repository Pattern

Just an example for understanding.

```typescript
// repositories/TopicRepository.ts
export class TopicRepository {
  async findById(id: string, tx?: Transaction): Promise<Topic | null> {
    const db = tx || DbService.db
    return await db.select()
      .from(topicTable)
      .where(eq(topicTable.id, id))
      .limit(1)
  }

  async findByIdWithMessages(
    topicId: string,
    pagination: PaginationOptions
  ): Promise<TopicWithMessages> {
    // Complex join query with pagination
    // Handles GB-scale data efficiently
  }
}
```

#### Direct Drizzle Pattern (Simple Services)
```typescript
// services/SimpleService.ts
export class SimpleService extends BaseService {
  async getItem(id: string) {
    // Direct Drizzle query for simple operations
    return await this.database
      .select()
      .from(itemTable)
      .where(eq(itemTable.id, id))
  }
}
```

#### Planned Repositories
- **TopicRepository**: Complex topic data access with message relationships
- **MessageRepository**: GB-scale message queries with pagination
- **FileRepository**: File reference counting and cleanup logic

**Decision Principle**: Use the simplest approach that solves the problem. Add repository abstraction only when complexity demands it.

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
2. Implement handler in `api/handlers/index.ts` (thin layer, delegate to service)
3. Create business service in `services/` for domain logic
4. Create repository in `repositories/` if domain is complex (optional)
5. Add database schema in `db/schemas/` if required

### Adding Database Tables
1. Create schema in `db/schemas/{tableName}.ts`
2. Generate migration: `yarn run migrations:generate`
3. Add seeding data in `db/seeding/` if needed
4. Decide: Repository pattern or direct Drizzle?
   - Complex domain → Create repository in `repositories/`
   - Simple domain → Use direct Drizzle in service
5. Create business service in `services/`
6. Implement API handler in `api/handlers/`

### Creating a New Business Service

**For complex domains (with repository)**:
```typescript
// 1. Create repository: repositories/ExampleRepository.ts
export class ExampleRepository {
  async findById(id: string, tx?: Transaction) { /* ... */ }
  async create(data: CreateDto, tx?: Transaction) { /* ... */ }
}

// 2. Create service: services/ExampleService.ts
export class ExampleService {
  constructor(private exampleRepo: ExampleRepository) {}

  async createExample(data: CreateDto) {
    // Business validation
    this.validate(data)

    // Use repository
    return await this.exampleRepo.create(data)
  }
}

// 3. Create handler: api/handlers/example.ts
import { ExampleService } from '../../services/ExampleService'

export const exampleHandlers = {
  'POST /examples': async ({ body }) => {
    return await ExampleService.getInstance().createExample(body)
  }
}
```

**For simple domains (direct Drizzle)**:
```typescript
// 1. Create service: services/SimpleService.ts
export class SimpleService extends BaseService {
  async getItem(id: string) {
    // Direct database access
    return await this.database
      .select()
      .from(itemTable)
      .where(eq(itemTable.id, id))
  }
}

// 2. Create handler: api/handlers/simple.ts
export const simpleHandlers = {
  'GET /items/:id': async ({ params }) => {
    return await SimpleService.getInstance().getItem(params.id)
  }
}
```

## Data Flow

### Complete Request Flow

```
┌─────────────────────────────────────────────────────┐
│ Renderer Process                                     │
│   React Component → useDataApi Hook                  │
└────────────────┬────────────────────────────────────┘
                 │ IPC Request
┌────────────────▼────────────────────────────────────┐
│ Infrastructure Layer                                 │
│   DataApiService (coordinator)                       │
│       ↓                                              │
│   ApiServer (routing) → MiddlewareEngine             │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│ API Layer (api/handlers/)                           │
│   Handler: Thin layer                                │
│   - Extract parameters                               │
│   - Call business service                            │
│   - Transform response                               │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│ Business Logic Layer (services/)                    │
│   Service: Domain logic                              │
│   - Business validation                              │
│   - Transaction coordination                         │
│   - Call repository or direct DB                     │
└────────────────┬────────────────────────────────────┘
                 │
      ┌──────────┴──────────┐
      │                     │
┌─────▼─────────┐   ┌──────▼──────────────────────────┐
│ repositories/ │   │ Direct Drizzle                   │
│ (Complex)     │   │ (Simple domains)                 │
│ - Repository  │   │ - Service uses DbService.db      │
│ - Query logic │   │ - Inline queries                 │
└─────┬─────────┘   └──────┬──────────────────────────┘
      │                    │
      └──────────┬─────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│ Database Layer (db/)                                 │
│   DbService → SQLite (Drizzle ORM)                   │
└─────────────────────────────────────────────────────┘
```

### Architecture Principles

1. **Separation of Concerns**
   - Handlers: Request/response transformation only
   - Services: Business logic and orchestration
   - Repositories: Data access (when complexity demands it)

2. **Dependency Flow** (top to bottom only)
   - Handlers depend on Services
   - Services depend on Repositories (or DbService directly)
   - Repositories depend on DbService
   - **Never**: Services depend on Handlers
   - **Never**: Repositories contain business logic

3. **Selective Repository Usage**
   - Use Repository: Complex domains (Topic, Message, File)
   - Direct Drizzle: Simple domains (Agent, Session, Translate)
   - Decision based on: query complexity, data volume, testing needs

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