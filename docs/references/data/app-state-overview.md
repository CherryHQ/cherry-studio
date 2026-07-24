# App State System Overview

`app_state` is a SQLite-backed key-value table holding durable **internal continuity markers** — the app's own record of one-time work it has performed (data migration, seeding, one-off setup).
It exists to preserve functional continuity across restarts: losing a value does not lose user data, but makes the app re-run a one-time flow the user has already been through.

## When to Use

Write to `app_state` only when **all three** hold:

| Question                                                      | Required answer |
| ------------------------------------------------------------- | --------------- |
| Is this internal app/module state, not a user-facing setting? | Yes             |
| Must it survive restarts?                                     | Yes             |
| Would losing it make the user re-experience a one-time flow?  | Yes             |

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

No dedicated service — the owning module reads/writes `appStateTable` directly through its own `DbType` handle.

**Why none today:** every current consumer runs during app startup, at or before the lifecycle's earliest phase, so a lifecycle-managed service would be unavailable to them — preboot migration even supplies its own DB connection. App-state content is inherently startup-stage; no consumer yet needs it during a later lifecycle phase.

**Future:** if consumers with a confirmed need arise during or after the lifecycle, a shared app-state access service may be introduced then. Do not add one preemptively.

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
| `migration_v2_status` | `MigrationEngine` | `MigrationStatusValue`  | **Grandfathered exception.** Bare key predating the `<scope>:` convention; serves only the one-time v1→2.0.0 migration and disappears when the migration module is removed after 2.0.x. Do not rename; do not model new keys on it. |

## Related Source Code

| File                                                  | Purpose                       |
| ----------------------------------------------------- | ----------------------------- |
| `src/main/data/db/schemas/appState.ts`                | Table schema                  |
| `src/main/data/db/seeding/SeedRunner.ts`              | `seed:*` owner                |
| `src/main/data/migration/v2/core/MigrationEngine.ts`  | `migration_v2_status` owner   |

## Related Documentation

- [Database Seeding Guide](./database-seeding-guide.md) — `seed:*` journal usage
- [Data System Reference](./README.md) — choosing among data systems
