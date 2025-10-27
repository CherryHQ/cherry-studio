# Agents Service

Simplified Drizzle ORM implementation for agent and session management in Cherry Studio.

## Features

- **Native Drizzle migrations** - Uses built-in migrate() function
- **Zero CLI dependencies** in production
- **Auto-initialization** with retry logic
- **Full TypeScript** type safety
- **Model validation** to ensure models exist and provider configuration matches the agent type

## Schema

- `agents.schema.ts` - Agent definitions
- `sessions.schema.ts` - Session and message tables
- `migrations.schema.ts` - Migration tracking

## Usage

```typescript
import { agentService } from './services'

// Create agent - fully typed
const agent = await agentService.createAgent({
  type: 'custom',
  name: 'My Agent',
  model: 'anthropic:claude-3-5-sonnet-20241022'
})
```

## Model Validation

- Model identifiers must use the `provider:model_id` format (for example `anthropic:claude-3-5-sonnet-20241022`).
- `model`, `plan_model`, and `small_model` are validated against the configured providers before the database is touched.
- Invalid configurations return a `400 invalid_request_error` response and the create/update operation is aborted.

## Development Commands

```bash
# Apply schema changes
yarn agents:generate

# Quick development sync
yarn agents:push

# Database tools
yarn agents:studio    # Open Drizzle Studio
yarn agents:health    # Health check
yarn agents:drop      # Reset database
```

## Workflow

1. **Edit schema** in `/database/schema/`
2. **Generate migration** with `yarn agents:generate`
3. **Test changes** with `yarn agents:health`
4. **Deploy** - migrations apply automatically

## Services

- `AgentService` - Agent CRUD operations
- `SessionService` - Session management
- `SessionMessageService` - Message logging
- `BaseService` - Database utilities
- `schemaSyncer` - Migration handler

## Troubleshooting

```bash
# Check status
yarn agents:health

# Apply migrations
yarn agents:migrate

# Reset completely
yarn agents:reset --yes
```

The simplified migration system reduced complexity from 463 to ~30 lines while maintaining all functionality through Drizzle's native migration system.
