# Main Data Layer

This directory contains the main process data management implementation.

## Documentation

- **Overview**: [docs/en/references/data/README.md](../../../docs/en/references/data/README.md)
- **DataApi in Main**: [data-api-in-main.md](../../../docs/en/references/data/data-api-in-main.md)
- **Database Patterns**: [database-patterns.md](../../../docs/en/references/data/database-patterns.md)

## Directory Structure

```
src/main/data/
├── api/                       # Data API framework
│   ├── core/                  # ApiServer, MiddlewareEngine, adapters
│   └── handlers/              # API endpoint implementations
├── services/                  # Business logic layer
├── repositories/              # Data access layer (selective usage)
├── db/                        # Database layer
│   ├── schemas/               # Drizzle table definitions
│   ├── seeding/               # Database initialization
│   └── DbService.ts           # Database connection management
├── migration/                 # Data migration system
├── CacheService.ts            # Cache management
├── DataApiService.ts          # API coordination
└── PreferenceService.ts       # User preferences
```

## Quick Reference

### Adding New API Endpoints

1. Define schema in `@shared/data/api/schemas/`
2. Implement handler in `api/handlers/`
3. Create business service in `services/`
4. Create repository in `repositories/` (if complex domain)

### Database Commands

```bash
# Generate migrations
yarn db:migrations:generate
```
