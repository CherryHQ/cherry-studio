# Boot Config System Overview

The Boot Config system provides synchronous, file-based configuration for settings that must be available **before** the application lifecycle takes over — before the database, before PreferenceService, before any lifecycle phase runs.

## Purpose

BootConfigService handles data that:

- Must be loaded **synchronously at process startup** (before any async initialization)
- Affects **process-level behavior** that cannot be changed at runtime (e.g., Chromium flags)
- Cannot wait for database initialization (SQLite is not yet available)
- Needs to be read **before** the lifecycle system's `BeforeReady` phase

Typical examples: disabling hardware acceleration, setting user data directory paths, configuring Chromium command-line switches.

## Boot Timing

```
┌──────────────────────────────────────────────────────────────────────┐
│ App Startup Sequence                                                 │
│                                                                      │
│  1. BootConfig load        ← Sync read of boot-config.json           │
│     (bootConfigService)      Only data system available here         │
│          │                                                           │
│  2. Bootstrap              ← App data directory setup                │
│          │                                                           │
│  3. application.bootstrap()                                          │
│          │                                                           │
│          ├── Background phase (fire-and-forget)                      │
│          │                                                           │
│          ├── Promise.all([                                           │
│          │     BeforeReady phase,  ← DB init, PreferenceService,     │
│          │     app.whenReady()       CacheService, DataApiService    │
│          │   ])                                                      │
│          │                                                           │
│          └── WhenReady phase       ← Window creation, IPC handlers   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

BootConfig is the **only** data system available at stage 1 — before the lifecycle system takes over. The `BeforeReady` phase and `app.whenReady()` run **in parallel** (via `Promise.all`); once both complete, `WhenReady` services start. From the `BeforeReady` phase onward, **public** boot config values are also accessible through PreferenceService via the `BootConfig.*` prefix. Internal `temp.*` keys are the exception — they are never exposed through PreferenceService (see [Internal `temp.*` namespace](#internal-temp-namespace)).

## Key Characteristics

### Synchronous Loading

- Reads `boot-config.json` via `fs.readFileSync` on module import
- No async, no promises — values available immediately at the top of `src/main/main.ts`
- If the file is missing (first launch), falls back to defaults
- If the file is corrupt, records the error — the app should not continue with corrupted boot config

### Flat Key-Value Structure

Keys follow the same naming convention as preferences: `namespace.key_name`

| Key                                 | Type      | Default | Description                            |
| ----------------------------------- | --------- | ------- | -------------------------------------- |
| `app.disable_hardware_acceleration` | `boolean` | `false` | Disable Chromium hardware acceleration |

### Atomic File Writes

- Writes to a temp file first, then renames to `boot-config.json`
- Prevents corruption from crashes during write

### Saving

- `set()` marks state dirty and schedules a **debounced** background save (350ms) to coalesce rapid changes. Background saves are **best-effort**: a write failure is logged, not thrown, and the dirty flag is kept for a later retry.
- `flush()` — force an immediate write, **best-effort** (never throws; logs and swallows failures). Use only where a failed write is genuinely tolerable, e.g. app quit.
- `persist()` — force an immediate write, **strict** (throws on any fs failure; dirty flag retained on failure for retry). Use wherever a failed write has consequences — `BootConfigMigrator`, the preboot userData pin (`pinUserDataPath`, whose silent failure would loop the next launch), or an IPC handler that must not report success before the change is on disk. **Choose strict vs. best-effort by the consequence of failure, not by "it runs in preboot"** — a preboot caller that needs durability uses `persist()` and routes the throw to an explicit fatal path, rather than downgrading to `flush()`.

### Error Handling

- Tracks load errors: `parse_error` (invalid JSON) or `read_error` (file inaccessible)
- **Missing file** (first launch): falls back to `DefaultBootConfig` — this is normal
- **Corrupt file**: records the error via `loadError`. The app should check `hasLoadError()` and **abort startup** rather than continue with potentially incorrect configuration
- Errors can be inspected via `hasLoadError()` / `getLoadError()` / `clearLoadError()`

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Early Boot (before lifecycle)                                   │
│                                                                 │
│  src/main/main.ts                                               │
│       │                                                         │
│       ▼                                                         │
│  bootConfigService.get('app.disable_hardware_acceleration')     │
│       │              ▲                                          │
│       ▼              │                                          │
│  ┌───────────────────┴──────────────────┐                       │
│  │ BootConfigService                    │                       │
│  │ - Sync load on import                │                       │
│  │ - In-memory config map               │◄──── boot-config.json │
│  │ - Debounced save                     │      (~/.cherrystudio/)│
│  └──────────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ After Lifecycle Starts                                          │
│                                                                 │
│  Renderer                          Main Process                 │
│  ┌──────────────────┐              ┌──────────────────────────┐ │
│  │ usePreference    │    IPC       │ PreferenceService        │ │
│  │ ('BootConfig.*') │─────────────►│ detects BootConfig.*     │ │
│  └──────────────────┘              │ prefix, routes to        │ │
│                                    │ bootConfigService        │ │
│                                    └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

BootConfig also carries data migrated from v1's `~/.cherrystudio/config/config.json` file (see `BootConfigMigrator`'s file source). The `app.user_data_path` key holds the custom user data directory mapping that the v1 file stored under `appDataPath`. Long-term, BootConfig will fully replace the legacy `config/config.json` — the follow-up PR will rewire `initAppDataDir()` to read `app.user_data_path` from BootConfig instead of parsing the legacy file directly.

## Access Convention

| Context                            | API                                               | Note                                             |
| ---------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| Early boot (before lifecycle)      | `bootConfigService.get(key)` / `.set(key, value)` | Only option — DB and lifecycle not yet available |
| Lifecycle services (Main)          | `preferenceService.get('BootConfig.*')`           | Standardized; enables cross-window sync          |
| Renderer (React components)        | `usePreference('BootConfig.*')`                   | Same as regular preference usage                 |
| Internal `temp.*` keys (any phase) | `bootConfigService.get/set` / `.onChange()`       | Never exposed via PreferenceService — see below  |

**Rule:** Once the lifecycle is running, **always** access **public** boot config values through PreferenceService. Direct `bootConfigService` usage is reserved for two cases: early boot code, and the internal `temp.*` namespace (below).

For detailed usage of `usePreference` and `preferenceService`, see [Preference Usage Guide](./preference-usage.md).

### Internal `temp.*` namespace

Boot config keys under the `temp.*` prefix are **main-process-internal transient state** — single in-flight operations meant to be cleared once consumed (e.g. `temp.user_data_relocation`). They are deliberately **excluded** from the unified preference API:

- Not present in `UnifiedPreferenceType`; not reachable via preload or `usePreference`.
- Rejected at the PreferenceService IPC boundary (`get` / `set` / `getMultipleRaw` / `setMultiple` / `subscribe`), and filtered out of `getAll()`.

Restoring a stale `temp.*` entry (via backup, sync, or a different machine) can cause silent data corruption, so these keys are never backed up or synced. Owning main-process modules **must** use `bootConfigService` directly — at any phase, not only early boot — and `bootConfigService.onChange()` for in-process change notification.

## BootConfig vs Preference

| Aspect            | BootConfig                               | Preference                                                      |
| ----------------- | ---------------------------------------- | --------------------------------------------------------------- |
| Loading           | Synchronous, before lifecycle takes over | Async, at `BeforeReady` phase (parallel with `app.whenReady()`) |
| Storage           | `boot-config.json` (filesystem)          | SQLite database                                                 |
| Availability      | From process start                       | After DB initialization                                         |
| Use case          | Process-level flags, Chromium switches   | User-modifiable app settings                                    |
| Cross-window sync | Via PreferenceService delegation         | Native                                                          |
| Key count         | Minimal (process-level only)             | 158+ keys                                                       |

## PreferenceService Integration

Boot config keys are accessible through PreferenceService using the `BootConfig.` prefix:

- `preferenceService.get('BootConfig.app.disable_hardware_acceleration')` routes to `bootConfigService.get('app.disable_hardware_acceleration')`
- The `BootConfigPreferenceKeys` mapped type automatically adds the `BootConfig.` prefix to all **public** boot config keys — internal `temp.*` keys (`InternalBootConfigKey`) are excluded
- The `UnifiedPreferenceType` merges preference and **public** boot config type spaces, providing full type safety
- Changes made through PreferenceService are broadcast to all windows

Utility functions in `src/shared/data/preference/preferenceUtils.ts`:

| Function                     | Purpose                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `isBootConfigKey(key)`       | Check if a key has the `BootConfig.` prefix                                       |
| `isPublicBootConfigKey(key)` | Whitelist guard — true only for a `BootConfig.` key that is public (not internal) |
| `toBootConfigKey(key)`       | Strip `BootConfig.` prefix to get the underlying key                             |
| `getDefaultValue(key)`       | Unified default lookup for both preference and boot config keys                  |

## File Storage

- **Path:** `~/.cherrystudio/boot-config.json` (intentionally outside `userData`)
- **Format:** Flat JSON object, pretty-printed (2-space indent)

> **Why outside `userData`?** Boot config must be readable *before* the app data directory is determined. Storing it under `userData` would create a chicken-and-egg problem: the file that decides where data lives cannot itself live inside that data. Placing it under `~/.cherrystudio/` keeps it stable across changes to `appDataPath` and ensures it is always available at process start, before `initAppDataDir()` runs.

```json
{
  "app.disable_hardware_acceleration": false,
  "app.user_data_path": {
    "/Applications/Cherry Studio.app/Contents/MacOS/Cherry Studio": "/Volumes/External/CherryData"
  }
}
```

`app.user_data_path` is a `Record<executablePath, dataPath>` keyed by the executable path — same-machine multiple installations (stable / dev / portable) can each have their own user data directory, matching the semantic of v1's `appDataPath` array.

## Related Source Code

| File                                                   | Purpose                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `src/main/data/bootConfig/BootConfigService.ts`        | Core service — sync load, debounced save, change notifications |
| `src/main/data/bootConfig/types.ts`                    | `BootConfigLoadError` type definition                          |
| `src/shared/data/bootConfig/bootConfigSchemas.ts` | `BootConfigSchema` interface and `DefaultBootConfig`           |
| `src/shared/data/bootConfig/bootConfigTypes.ts`   | `BootConfigKey`, `Public`/`InternalBootConfigKey`, `BootConfigPreferenceKeys` mapped type |
| `src/shared/data/preference/preferenceUtils.ts`   | `BootConfig.*` prefix routing + `isPublicBootConfigKey` whitelist guard |
| `src/main/data/PreferenceService.ts`                   | Routes `BootConfig.*` keys to `bootConfigService`              |
| `src/main/main.ts`                                     | Early boot usage (first import, hardware acceleration check)   |

## Related Documentation

- [Boot Config Schema Guide](./boot-config-schema-guide.md) - Adding new boot config keys
- [Preference Overview](./preference-overview.md) - PreferenceService architecture
- [Preference Usage Guide](./preference-usage.md) - `usePreference` hook and service API
