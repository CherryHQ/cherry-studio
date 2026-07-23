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
├── dataApiDataChange.ts       # DataApi data change notification publisher (post-commit → all-window broadcast)
└── PreferenceService.ts       # User preferences
```

## DataApi Data Change Notification (governance exception)

`dataApiDataChange.ts` (`notifyDataApiDataChange`) is a **strictly limited
exception** to the DataApi governance rules — a data service publishing a signal
that then reaches IPC. It is intentionally NOT part of the portable transport
framework in `api/` (which reserves an HttpAdapter and must not depend on
Electron/WindowManager).

> A data service may publish a read-model observation signal after data is
> successfully committed, for cross-window data convergence.

Fences (all hard constraints):

- Publish only **after commit**, never inside a transaction.
- **Not part of write success** — notification failure must not roll back or
  affect committed data.
- Describes **endpoint/read-model changes only**; it must **not** carry entity
  rows, field diffs, SQL predicates, or business commands.
- Must **not** be used to perform file, network, process, window-control, or
  external-service work.
- Renderer consumers may use it **only** for fact refetching and local
  reconciliation.

This is **not** an escape hatch for general side effects in DataApi.

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
