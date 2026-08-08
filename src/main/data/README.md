# Main Data Layer

This directory contains the main process data management implementation.

## Documentation

- **Overview**: [docs/references/data/README.md](../../../docs/references/data/README.md)
- **DataApi in Main**: [data-api-in-main.md](../../../docs/references/data/data-api-in-main.md)
- **Database Patterns**: [database-patterns.md](../../../docs/references/data/database-patterns.md)

## Directory Structure

```
src/main/data/
├── api/                       # Data API framework
│   ├── core/                  # ApiServer, MiddlewareEngine, adapters
│   └── handlers/              # API endpoint implementations
├── services/                  # Business logic layer (see services/README.md)
│   └── utils/                 # Row → Entity mapping utilities (see utils/README.md)
├── db/                        # Database layer
│   ├── schemas/               # Drizzle table definitions
│   ├── seeding/               # Database initialization
│   └── DbService.ts           # Database connection management
├── migration/                 # Data migration system
├── CacheService.ts            # Cache management
├── DataApiService.ts          # API coordination
├── PreferenceService.ts       # User preferences
└── dataApiDataChange.ts       # DataApi data change notification (post-commit broadcast)
```

## Data Change Notification

`notifyDataApiDataChange(effects)` is the single publish point for cross-window data convergence: after a business write **successfully commits**, the owning data service states which read models changed (`DataApiDataChangeEffect[]`), and the signal is broadcast to all windows. This is a strictly fenced exception to the "no side effects in data services" rule — see [Fenced Exception: Data Change Notification](../../../docs/references/data/api-design-guidelines.md#fenced-exception-data-change-notification) for the fences, and the notifier's own doc comment for publish invariants (post-commit timing, `*Tx()` never notifies, no-op writes may skip) and the delivery contract.

It deliberately lives at the `data/` top level, NOT in `api/` — `api/` is the portable transport framework (HttpAdapter reserved), while this capability is an Electron/IPC special case depending on `WindowManager`.

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
