---
description: Preference architecture - generated key schema, SQLite ownership, BootConfig routing, renderer cache, and cross-window sync
sources:
  - src/main/data/PreferenceService.ts
  - src/renderer/data/PreferenceService.ts
  - src/renderer/data/hooks/usePreference.ts
  - src/shared/data/preference
  - src/main/data/db/schemas/preference.ts
---

# Preference System Overview

Preference stores small, fixed-key user settings that must persist and converge
across windows. It is not for user-created records, large collections, or
regenerable UI state.

## Contract

- DB-backed keys and defaults are generated in
  `src/shared/data/preference/preferenceSchemas.ts`.
- `PreferenceKeyType` covers SQLite-backed keys.
- `UnifiedPreferenceKeyType` also includes public BootConfig keys under the
  `BootConfig.` prefix.
- Every key has a generated default. Callers observe a value even before a
  renderer cache miss finishes loading.
- Keys are fixed by the schema; users modify values, not the key set.

The adding-key workflow is documented in
[Preference Schema Guide](./preference-schema-guide.md). The generated file is
not edited directly.

## Storage and Routing

The `preference` table uses `(scope, key)` as its primary key and stores JSON
values. The current runtime scope is `default`.

Main `PreferenceService.resolveKey()` routes each unified key:

| Key | Store |
|---|---|
| Ordinary generated key, such as `ui.theme_mode` | SQLite preference row |
| Public `BootConfig.app.*` key | File-backed `bootConfigService` |
| Internal `BootConfig.temp.*`, unknown or inherited key | Rejected at the unified Preference boundary |

A mixed `setMultiple` validates every route before writing. BootConfig writes
and the SQLite transaction are separate stores and therefore are not one atomic
cross-store commit.

Database keys must be own keys of the generated default registry. Loading stored
rows ignores unregistered keys, and the mutable cache is separate from that
registry. This validates key membership, not ordinary preference value shapes:
SQLite preference values currently have no per-key runtime schemas. BootConfig
values pass their selected Zod schema before mutation.

`getMultiple` captures own enumerable string aliases once and reads the requested
preferences from that mapping. Inherited aliases are ignored; literal aliases
such as `__proto__` remain own data properties on the result.

## Process Responsibilities

### Main

The lifecycle-managed Main service loads DB-backed preferences into memory,
serves reads, persists writes, and broadcasts changes to subscribed renderer
windows. Ordinary `get()` and `getMultiple()` reads are synchronous memory
lookups. `set()` and `setMultiple()` are asynchronous because notification may
cross process boundaries even though the better-sqlite3 write itself is
synchronous.

### Renderer

The renderer singleton caches values lazily. A read fetches an uncached key from
Main and establishes the matching subscription. Main broadcasts later changes;
the renderer updates its cache and notifies hook subscribers.

`usePreference` and `useMultiplePreferences` use `useSyncExternalStore`, expose
generated defaults while an uncached value loads, and return Promise-based
setters.

## Update Strategies

Renderer writes are optimistic by default:

1. Update the local cache and notify React.
2. Persist through Main.
3. Confirm on success or restore the protected original value on failure.

With `{ optimistic: false }`, the renderer waits for Main to confirm persistence
before changing its cache. Use this when the UI must not present an unconfirmed
setting as saved.

Batch operations apply the same choice to every key in the batch. The renderer
captures a shallow update snapshot and validates its keys before either strategy
changes the cache or sends IPC. Top-level reassignment by the caller cannot change
a pending batch; nested arrays and objects retain their existing reference
ownership. A pending batch read likewise retains its requested key list for the
matching subscriptions. Main skips unchanged values and publishes notifications
only after successful writes.

## Data-System Boundary

| Data | Owner |
|---|---|
| Theme, language, feature toggles, shortcuts | Preference |
| Process flags needed before lifecycle | BootConfig, exposed later through `BootConfig.*` |
| Regenerable window/UI state | Cache |
| Providers, conversations, notes, other business rows | DataApi/SQLite entity services |

API credentials attached to providers are provider business data, not a generic
Preference key.

## Debugging

Main `PreferenceService.getStats(details?)` reports key and subscription counts.
The detailed form is intended for diagnostics because it includes per-key
subscription data.

All `Preference_*` IPC entry points are sender-gated. Renderer code uses
the service and hooks rather than calling those channels directly.

## Related Documentation

- [Preference Usage](./preference-usage.md)
- [Preference Schema Guide](./preference-schema-guide.md)
- [Boot Config Overview](./boot-config-overview.md)
