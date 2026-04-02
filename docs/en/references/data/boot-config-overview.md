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

BootConfig is the **only** data system available at stage 1 — before the lifecycle system takes over. The `BeforeReady` phase and `app.whenReady()` run **in parallel** (via `Promise.all`); once both complete, `WhenReady` services start. From the `BeforeReady` phase onward, boot config values are also accessible through PreferenceService via the `BootConfig.*` prefix.

## Key Characteristics

### Synchronous Loading

- Reads `boot-config.json` via `fs.readFileSync` on module import
- No async, no promises — values available immediately at the top of `src/main/index.ts`
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

### Debounced Saving

- Writes are debounced by 500ms to coalesce rapid changes
- `flush()` forces an immediate write (used on app quit)

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
│  src/main/index.ts                                              │
│       │                                                         │
│       ▼                                                         │
│  bootConfigService.get('app.disable_hardware_acceleration')     │
│       │              ▲                                          │
│       ▼              │                                          │
│  ┌───────────────────┴──────────────────┐                       │
│  │ BootConfigService                    │                       │
│  │ - Sync load on import                │                       │
│  │ - In-memory config map               │◄──── boot-config.json │
│  │ - Debounced save                     │      ({userData}/)    │
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

## Access Convention

| Context                       | API                                               | Note                                             |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| Early boot (before lifecycle) | `bootConfigService.get(key)` / `.set(key, value)` | Only option — DB and lifecycle not yet available |
| Lifecycle services (Main)     | `preferenceService.get('BootConfig.*')`           | Standardized; enables cross-window sync          |
| Renderer (React components)   | `usePreference('BootConfig.*')`                   | Same as regular preference usage                 |

**Rule:** Once the lifecycle is running, **always** access boot config values through PreferenceService. Direct `bootConfigService` usage is reserved exclusively for early boot code.

For detailed usage of `usePreference` and `preferenceService`, see [Preference Usage Guide](./preference-usage.md).

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
- The `BootConfigPreferenceKeys` mapped type automatically adds the `BootConfig.` prefix to all boot config keys
- The `UnifiedPreferenceType` merges both preference and boot config type spaces, providing full type safety
- Changes made through PreferenceService are broadcast to all windows

Utility functions in `packages/shared/data/preference/preferenceUtils.ts`:

| Function               | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `isBootConfigKey(key)` | Check if a key has the `BootConfig.` prefix                     |
| `toBootConfigKey(key)` | Strip `BootConfig.` prefix to get the underlying key            |
| `getDefaultValue(key)` | Unified default lookup for both preference and boot config keys |

## File Storage

- **Path:** `{userData}/boot-config.json`
- **Format:** Flat JSON object, pretty-printed (2-space indent)

```json
{
  "app.disable_hardware_acceleration": false
}
```

## Related Source Code

| File                                                   | Purpose                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `src/main/data/bootConfig/BootConfigService.ts`        | Core service — sync load, debounced save, change notifications |
| `src/main/data/bootConfig/types.ts`                    | `BootConfigLoadError` type definition                          |
| `packages/shared/data/bootConfig/bootConfigSchemas.ts` | `BootConfigSchema` interface and `DefaultBootConfig`           |
| `packages/shared/data/bootConfig/bootConfigTypes.ts`   | `BootConfigKey`, `BootConfigPreferenceKeys` mapped type        |
| `packages/shared/data/preference/preferenceUtils.ts`   | `BootConfig.*` prefix routing utilities                        |
| `src/main/data/PreferenceService.ts`                   | Routes `BootConfig.*` keys to `bootConfigService`              |
| `src/main/index.ts`                                    | Early boot usage (first import, hardware acceleration check)   |

## Related Documentation

- [Boot Config Schema Guide](./boot-config-schema-guide.md) - Adding new boot config keys
- [Preference Overview](./preference-overview.md) - PreferenceService architecture
- [Preference Usage Guide](./preference-usage.md) - `usePreference` hook and service API
