# Data API Type System

This directory contains type definitions for the DataApi system.

## Documentation

- **DataApi Overview**: [docs/references/data/data-api-overview.md](../../../../docs/references/data/data-api-overview.md)
- **API Types**: [api-types.md](../../../../docs/references/data/api-types.md)
- **API Design Guidelines**: [api-design-guidelines.md](../../../../docs/references/data/api-design-guidelines.md)

## Directory Structure

```
src/shared/data/api/
├── types.ts           # Core request/response types
├── paths.ts           # Path template utilities
├── errors.ts          # Error handling
└── schemas/
    ├── apiSchemas.ts  # Schema composition
    └── *.ts           # Domain-specific schemas
```

## Quick Reference

### Import Conventions

Every module is imported directly — there is no barrel. Infrastructure types come from `types` / `paths` / `errors`; domain DTOs come from their schema files.

```typescript
// Infrastructure types (direct module imports)
import type { DataRequest, DataResponse, ApiClient } from '@shared/data/api/types'
import { ErrorCode, DataApiError, DataApiErrorFactory } from '@shared/data/api/errors'

// Domain DTOs (directly from schema files)
import type { Topic, CreateTopicDto } from '@shared/data/api/schemas/topics'
import type { Message, CreateMessageDto } from '@shared/data/api/schemas/messages'
```

### Adding New Schemas

1. Create schema file in `schemas/` (e.g., `topics.ts`)
2. Register in `schemas/apiSchemas.ts` using intersection type
3. Implement handlers in `src/main/data/api/handlers/`
