# Database Seeding Guide

## Overview

The seeding system populates initial and builtin data on app startup. It uses `SeedRunner` as the orchestrator with journal-based version tracking via the `app_state` table. Each seeder declares a version string; `SeedRunner` compares it against the stored journal entry and skips execution when the versions match.

Seeding runs during `DbService.onInit()` at `Phase.BeforeReady`, before the application is fully ready.

## Architecture

### Components

**`ISeeder` interface** (`src/main/data/db/types.d.ts`)

```typescript
export interface ISeeder {
  readonly name: string        // Unique identifier (stored as `seed:<name>` in app_state)
  readonly version: string     // Version string for change detection (property or getter)
  readonly description: string // Human-readable description for logging
  run(db: DbType): Promise<void> // Execute the seed operation
}
```

**`SeedRunner`** (`src/main/data/db/seeding/SeedRunner.ts`)

Reads journal entries from `app_state` (key = `seed:<name>`), compares version strings, skips if they match, and runs the seeder in a transaction if they differ. The journal update is part of the same transaction, ensuring atomicity.

**`seeding/index.ts`** (`src/main/data/db/seeding/index.ts`)

Exports an ordered array of `ISeeder` instances. This is the only place you need to register a new seeder.

### Execution Flow

```
App startup
  -> DbService.onInit() (Phase.BeforeReady)
    -> SeedRunner.runAll(seeders)
      -> Load all journal entries from app_state in one query
      -> For each seeder:
           -> Compare seeder.version with journal version
           -> If match: skip (already applied)
           -> If different or missing:
                -> Begin transaction
                -> Run seeder.run(tx)
                -> Upsert journal entry (seed:<name>) with new version
                -> Commit transaction
```

## Version Strategies

Each seeder chooses its own version strategy. There are three approaches:

| Strategy | When to Use | How | Example |
|----------|-------------|-----|---------|
| Auto checksum | Static import, data <= 100 KB | `hashObject(data)` in constructor | `PreferenceSeeder`, `TranslateLanguageSeeder` |
| Data-source version | Data file has a built-in version field | Getter accessing data source API | `PresetProviderSeeder` via `getProvidersVersion()` |
| Manual version | Last resort only | `readonly version = '1'` | Avoid -- easy to forget bumping |

### Auto Checksum

Use `hashObject()` from `./hashObject.ts` to compute a SHA-256 hash of the seed data source. The version changes automatically whenever the data changes.

```typescript
import { hashObject } from './hashObject'

constructor() {
  this.version = hashObject(DefaultPreferences)
}
```

**Performance thresholds** (measured on typical hardware):

| Data Size | Hash Time | Suitable? |
|-----------|-----------|-----------|
| ~1 KB | ~0.004 ms | Yes |
| ~19 KB | ~0.029 ms | Yes |
| ~100 KB | ~0.1 ms | Yes (upper limit) |
| ~1.2 MB | ~2.5 ms | No -- use other strategies |

Recommended for statically imported data sources up to 100 KB.

### Data-Source Version

When the data source already provides a version identifier, use a getter to access it. This avoids hashing entirely.

```typescript
get version(): string {
  return this.getLoader().getProvidersVersion()
}
```

### Manual Version

A hardcoded string. Only use this when neither of the above strategies applies. The risk is forgetting to bump the version when the seed data changes.

```typescript
readonly version = '1'
```

## Adding a New Seeder

Two steps:

### 1. Create the seeder class

Create a file in `src/main/data/db/seeding/` implementing `ISeeder`:

```typescript
import type { DbType, ISeeder } from '../types'
import { hashObject } from './hashObject'

// The data source to seed
import { MY_BUILTIN_DATA } from '@shared/data/presets/myData'

export class MyDataSeeder implements ISeeder {
  readonly name = 'myData'
  readonly description = 'Insert builtin my-data entries'
  readonly version: string

  constructor() {
    this.version = hashObject(MY_BUILTIN_DATA)
  }

  async run(db: DbType): Promise<void> {
    // Check existing data to ensure idempotency
    const existing = await db.select({ id: myTable.id }).from(myTable)
    const existingIds = new Set(existing.map((r) => r.id))

    const newRows = MY_BUILTIN_DATA.filter((d) => !existingIds.has(d.id))

    if (newRows.length > 0) {
      await db.insert(myTable).values(newRows)
    }
  }
}
```

### 2. Register in `index.ts`

Add the instance to the `seeders` array in `src/main/data/db/seeding/index.ts`:

```typescript
import { MyDataSeeder } from './myDataSeeder'

export const seeders: ISeeder[] = [
  new PreferenceSeeder(),
  new TranslateLanguageSeeder(),
  new PresetProviderSeeder(),
  new MyDataSeeder(),  // <-- add here
]
```

No changes to `DbService` are needed.

## Important Notes

- **Idempotency**: Seed logic must check existing data before inserting. Users may have modified or deleted seeded records; the seeder should only insert records that do not already exist.
- **Transaction atomicity**: Each seed runs in its own transaction together with its journal update. If the seed fails, neither the data nor the journal entry is committed.
- **Phase**: Seeds run at `Phase.BeforeReady` during app initialization, before any services that depend on the seeded data are active.
- **Journal storage**: Journal entries are stored in the `app_state` table with key prefix `seed:` and a JSON value containing `version`. The table's built-in `updatedAt` column serves as the applied-at timestamp.
- **No manual DbService changes**: Adding a seeder only requires creating the class and registering it in the `seeders` array.
