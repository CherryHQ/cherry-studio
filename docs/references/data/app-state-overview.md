---
description: app_state SQLite table for durable owner-private completion and reconciliation markers
sources:
  - src/main/data/db/schemas/appState.ts
  - src/main/data/db/seeding/SeedRunner.ts
  - src/main/data/migration/v2/core/MigrationEngine.ts
  - src/main/services/file/tasks/contentMetadataGeneration.ts
---

# App State System Overview

`app_state` is a SQLite-backed key-value table holding durable internal markers:
the app's record of one-time work or reconciliation generations it has already
applied. Losing a value does not directly delete user data, but may repeat an
expensive migration, seed, or metadata reconciliation.

## When to Use

Write to `app_state` only when **all three** hold:

| Question                                                      | Required answer |
| ------------------------------------------------------------- | --------------- |
| Is this internal app/module state, not a user-facing setting? | Yes             |
| Must it survive restarts?                                     | Yes             |
| Would losing it repeat completed setup or reconciliation work? | Yes           |

Otherwise use another system:

| Data                                       | System            |
| ------------------------------------------ | ----------------- |
| User-facing setting                        | PreferenceService |
| Regenerable / silently rebuildable         | CacheService      |
| Business data from user activity           | DataApiService    |
| Process-level flag needed before lifecycle | BootConfigService |

## Schema

`src/main/data/db/schemas/appState.ts`:

| Column                    | Type           | Notes                                    |
| ------------------------- | -------------- | ---------------------------------------- |
| `key`                     | text, PK       | `<scope>:<name>` (see Key Naming)        |
| `value`                   | text (JSON)    | shape owned by the consumer              |
| `description`             | text, optional | human-readable note on the key's purpose |
| `createdAt` / `updatedAt` | timestamps     | `updatedAt` doubles as applied-at        |

## Rules

### Access

There is no shared service. Each owner reads and writes its own key through the
database handle already available to that owner. Migration receives its
dedicated migration DB; seeding uses the boot database; file metadata
reconciliation uses `DbService`. Sharing the table does not make keys a
cross-domain API.

### Ownership

- Every key has exactly **one owner module**. Only the owner reads and writes it.
- The owner defines the value type and casts on read. There is no shared value-shape registry.
- **No cross-domain reads.** A module must not read another module's key. If information must cross a domain boundary, the owner exposes it through its own interface (method / event / IPC) — never via a shared `app_state` read.

### Key Naming

- Format: `<scope>:<name>`, where `scope` identifies the owner module (reuse its `loggerService` context or service name).
- The scope prefix confines any naming collision to within a single owner.

### Disposability

- Keys are disposable: an owner may drop a key or switch to a new one at will. Orphaned rows in old installs are harmless — no reader means dead data.
- **Exception:** a key recording an irreversible "done" event (e.g. a completed migration) must not be silently renamed once shipped. Existing installs would lose the "done" fact and re-run the flow. Keep the key, or read the old key as a fallback during the rename.

## Key Registry

Every key currently in `app_state`. Add a row when introducing a key.

| Key                   | Owner            | Value shape             | Notes                                                                                                                                                                                                       |
| --------------------- | ---------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seed:<name>`         | `SeedRunner`     | `{ version: string }`   | Seeding journal, one row per seeder. See [Database Seeding Guide](./database-seeding-guide.md).                                                                                                              |
| `seedRunner:bootstrapCompleted` | `SeedRunner` | `{ completedAt: number }` | Bootstrap-window marker — set after the first fully-successful seeding pass; `bootstrap-only` seeders never run once present. Done-event key (see Disposability exception): never rename once shipped. |
| `fileManager:contentMetadataGeneration` | `FileManager` | `{ version: number }` | Trust generation for internal-file `size` / `contentHash`; a version change atomically invalidates old hashes before background reconciliation. |
| `migration_v2_status` | `MigrationEngine` | `MigrationStatusValue`  | **Grandfathered exception.** Bare key predating the `<scope>:` convention. Do not rename and do not model new keys on it. |

## Related Source Code

| File                                                  | Purpose                       |
| ----------------------------------------------------- | ----------------------------- |
| `src/main/data/db/schemas/appState.ts`                | Table schema                  |
| `src/main/data/db/seeding/SeedRunner.ts`              | `seed:*` owner                |
| `src/main/data/migration/v2/core/MigrationEngine.ts`  | `migration_v2_status` owner   |

## Related Documentation

- [Database Seeding Guide](./database-seeding-guide.md) — `seed:*` journal usage
- [Data System Reference](./README.md) — choosing among data systems
