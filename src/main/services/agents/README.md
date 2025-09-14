# Agents Service - Drizzle ORM Implementation

This service now uses a clean, modern Drizzle ORM implementation for all database operations.

## Database Schema

The database schema is defined in `/database/schema/` using Drizzle ORM:

- `agents.schema.ts` - Agent table and indexes
- `sessions.schema.ts` - Sessions and session logs tables
- `migrations.schema.ts` - Migration tracking (if needed)

## Working with the Database

### Development Setup

For new development, you can:

1. **Use Drizzle Kit to generate migrations from schema:**
   ```bash
   yarn drizzle-kit generate:sqlite --config src/main/services/agents/drizzle.config.ts
   ```

2. **Push schema directly to database (for development):**
   ```bash
   yarn drizzle-kit push:sqlite --config src/main/services/agents/drizzle.config.ts
   ```


3. **Create tables programmatically (if needed):**
   The schema exports can be used with `CREATE TABLE` statements.

### Usage

All database operations are now fully type-safe:

```typescript
import { agentService } from './services'

// Create an agent - fully typed
const agent = await agentService.createAgent({
  type: 'custom',
  name: 'My Agent',
  model: 'claude-3-5-sonnet-20241022'
})

// TypeScript knows the exact shape of the returned data
console.log(agent.id) // ✅ Type-safe
```

## Architecture

- **Pure Drizzle ORM**: No legacy migration system
- **Type Safety**: Full TypeScript integration
- **Modern Patterns**: Schema-first development
- **Simplicity**: Clean, maintainable codebase

## Services

- `AgentService` - CRUD operations for agents
- `SessionService` - Session management
- `SessionMessageService` - Message logging
- `BaseService` - Shared database utilities
