# DataApi in Main Process

This guide covers how to implement API handlers, services, and repositories in the Main process.

## Architecture Layers

```
Handlers → Services → Repositories → Database
```

- **Handlers**: Thin layer, extract params, call service, transform response
- **Services**: Business logic, validation, transaction coordination
- **Repositories**: Data access (for complex domains)
- **Database**: Drizzle ORM + SQLite

## Implementing Handlers

### Location
`src/main/data/api/handlers/`

### Handler Responsibilities
- Extract parameters from request
- Delegate to business service
- Transform response for IPC
- **NO business logic here**

### Example Handler

```typescript
// handlers/topic.ts
import type { ApiImplementation } from '@shared/data/api'
import { TopicService } from '@data/services/TopicService'

export const topicHandlers: Partial<ApiImplementation> = {
  '/topics': {
    GET: async ({ query }) => {
      const { page = 1, limit = 20 } = query ?? {}
      return await TopicService.getInstance().list({ page, limit })
    },
    POST: async ({ body }) => {
      return await TopicService.getInstance().create(body)
    }
  },
  '/topics/:id': {
    GET: async ({ params }) => {
      return await TopicService.getInstance().getById(params.id)
    },
    PUT: async ({ params, body }) => {
      return await TopicService.getInstance().replace(params.id, body)
    },
    PATCH: async ({ params, body }) => {
      return await TopicService.getInstance().update(params.id, body)
    },
    DELETE: async ({ params }) => {
      await TopicService.getInstance().delete(params.id)
    }
  }
}
```

### Register Handlers

```typescript
// handlers/index.ts
import { topicHandlers } from './topic'
import { messageHandlers } from './message'

export const allHandlers: ApiImplementation = {
  ...topicHandlers,
  ...messageHandlers
}
```

## Implementing Services

### Location
`src/main/data/services/`

### Service Responsibilities
- Business validation
- Transaction coordination
- Domain workflows
- Call repositories or direct Drizzle

### Example Service

```typescript
// services/TopicService.ts
import { DbService } from '@data/db/DbService'
import { TopicRepository } from '@data/repositories/TopicRepository'
import { DataApiErrorFactory } from '@shared/data/api'

export class TopicService {
  private static instance: TopicService
  private topicRepo: TopicRepository

  private constructor() {
    this.topicRepo = new TopicRepository()
  }

  static getInstance(): TopicService {
    if (!this.instance) {
      this.instance = new TopicService()
    }
    return this.instance
  }

  async list(options: { page: number; limit: number }) {
    return await this.topicRepo.findAll(options)
  }

  async getById(id: string) {
    const topic = await this.topicRepo.findById(id)
    if (!topic) {
      throw DataApiErrorFactory.notFound('Topic', id)
    }
    return topic
  }

  async create(data: CreateTopicDto) {
    // Business validation
    this.validateTopicData(data)

    return await this.topicRepo.create(data)
  }

  async update(id: string, data: Partial<UpdateTopicDto>) {
    const existing = await this.getById(id) // Throws if not found

    return await this.topicRepo.update(id, data)
  }

  async delete(id: string) {
    await this.getById(id) // Throws if not found
    await this.topicRepo.delete(id)
  }

  private validateTopicData(data: CreateTopicDto) {
    if (!data.name?.trim()) {
      throw DataApiErrorFactory.validation({ name: ['Name is required'] })
    }
  }
}
```

### Service with Transaction

```typescript
async createTopicWithMessage(data: CreateTopicWithMessageDto) {
  return await DbService.transaction(async (tx) => {
    // Create topic
    const topic = await this.topicRepo.create(data.topic, tx)

    // Create initial message
    const message = await this.messageRepo.create({
      ...data.message,
      topicId: topic.id
    }, tx)

    return { topic, message }
  })
}
```

## Implementing Repositories

### When to Use Repository Pattern

Use repositories for **complex domains**:
- ✅ Complex queries (joins, subqueries, aggregations)
- ✅ GB-scale data requiring pagination
- ✅ Complex transactions involving multiple tables
- ✅ Reusable data access patterns
- ✅ High testing requirements

### When to Use Direct Drizzle

Use direct Drizzle for **simple domains**:
- ✅ Simple CRUD operations
- ✅ Small datasets (< 100MB)
- ✅ Domain-specific queries with no reuse
- ✅ Fast development is priority

### Example Repository

```typescript
// repositories/TopicRepository.ts
import { eq, desc, sql } from 'drizzle-orm'
import { DbService } from '@data/db/DbService'
import { topicTable } from '@data/db/schemas/topic'

export class TopicRepository {
  async findAll(options: { page: number; limit: number }) {
    const { page, limit } = options
    const offset = (page - 1) * limit

    const [items, countResult] = await Promise.all([
      DbService.db
        .select()
        .from(topicTable)
        .orderBy(desc(topicTable.updatedAt))
        .limit(limit)
        .offset(offset),
      DbService.db
        .select({ count: sql<number>`count(*)` })
        .from(topicTable)
    ])

    return {
      items,
      total: countResult[0].count,
      page,
      limit
    }
  }

  async findById(id: string, tx?: Transaction) {
    const db = tx || DbService.db
    const [topic] = await db
      .select()
      .from(topicTable)
      .where(eq(topicTable.id, id))
      .limit(1)
    return topic ?? null
  }

  async create(data: CreateTopicDto, tx?: Transaction) {
    const db = tx || DbService.db
    const [topic] = await db
      .insert(topicTable)
      .values(data)
      .returning()
    return topic
  }

  async update(id: string, data: Partial<UpdateTopicDto>, tx?: Transaction) {
    const db = tx || DbService.db
    const [topic] = await db
      .update(topicTable)
      .set(data)
      .where(eq(topicTable.id, id))
      .returning()
    return topic
  }

  async delete(id: string, tx?: Transaction) {
    const db = tx || DbService.db
    await db
      .delete(topicTable)
      .where(eq(topicTable.id, id))
  }
}
```

### Example: Direct Drizzle in Service

For simple domains, skip the repository:

```typescript
// services/TagService.ts
import { eq } from 'drizzle-orm'
import { DbService } from '@data/db/DbService'
import { tagTable } from '@data/db/schemas/tag'

export class TagService {
  async getAll() {
    return await DbService.db.select().from(tagTable)
  }

  async create(name: string) {
    const [tag] = await DbService.db
      .insert(tagTable)
      .values({ name })
      .returning()
    return tag
  }

  async delete(id: string) {
    await DbService.db
      .delete(tagTable)
      .where(eq(tagTable.id, id))
  }
}
```

## Error Handling

### Using DataApiErrorFactory

```typescript
import { DataApiErrorFactory } from '@shared/data/api'

// Not found
throw DataApiErrorFactory.notFound('Topic', id)

// Validation error
throw DataApiErrorFactory.validation({
  name: ['Name is required', 'Name must be at least 3 characters'],
  email: ['Invalid email format']
})

// Database error
try {
  await db.insert(table).values(data)
} catch (error) {
  throw DataApiErrorFactory.database(error, 'insert topic')
}

// Invalid operation
throw DataApiErrorFactory.invalidOperation(
  'delete root message',
  'cascade=true required'
)

// Conflict
throw DataApiErrorFactory.conflict('Topic name already exists')

// Timeout
throw DataApiErrorFactory.timeout('fetch topics', 3000)
```

## Adding New Endpoints

### Step-by-Step

1. **Define schema** in `packages/shared/data/api/schemas/`

```typescript
// schemas/topic.ts
export interface TopicSchemas {
  '/topics': {
    GET: { response: PaginatedResponse<Topic> }
    POST: { body: CreateTopicDto; response: Topic }
  }
}
```

2. **Register schema** in `schemas/index.ts`

```typescript
export type ApiSchemas = AssertValidSchemas<TopicSchemas & MessageSchemas>
```

3. **Create service** in `services/`

4. **Create repository** (if complex) in `repositories/`

5. **Implement handler** in `handlers/`

6. **Register handler** in `handlers/index.ts`

## Best Practices

1. **Keep handlers thin**: Only extract params and call services
2. **Put logic in services**: All business rules belong in services
3. **Use repositories selectively**: Simple CRUD doesn't need a repository
4. **Always use `.returning()`**: Get inserted/updated data without re-querying
5. **Support transactions**: Accept optional `tx` parameter in repositories
6. **Validate in services**: Business validation belongs in the service layer
7. **Use error factory**: Consistent error creation with `DataApiErrorFactory`
