# Data API Type System

This directory contains type definitions for the DataApi system.

## Documentation

- **DataApi Overview**: [docs/en/references/data/data-api-overview.md](../../../../docs/en/references/data/data-api-overview.md)
- **API Types**: [api-types.md](../../../../docs/en/references/data/api-types.md)
- **API Design Guidelines**: [api-design-guidelines.md](../../../../docs/en/references/data/api-design-guidelines.md)

## Directory Structure

```
packages/shared/data/api/
├── index.ts           # Barrel exports
├── apiTypes.ts        # Core request/response types
├── apiPaths.ts        # Path template utilities
├── apiErrors.ts       # Error handling
└── schemas/
    ├── index.ts       # Schema composition
    └── *.ts           # Domain-specific schemas
```

## Quick Reference

### Import Conventions

```typescript
// Infrastructure types (via barrel)
import type { DataRequest, DataResponse, ApiClient } from '@shared/data/api'
import { ErrorCode, DataApiError, DataApiErrorFactory } from '@shared/data/api'

// Domain DTOs (directly from schema files)
import type { Topic, CreateTopicDto } from '@shared/data/api/schemas/topic'
import type { Message, CreateMessageDto } from '@shared/data/api/schemas/message'
```

### Adding New Schemas

1. Create schema file in `schemas/` (e.g., `topic.ts`)
2. Register in `schemas/index.ts` using intersection type
3. Implement handlers in `src/main/data/api/handlers/`
