# Cache System Overview

Three-tier cache for regenerable data. In-process memory, cross-window shared state, and localStorage-backed persistence.

## Scope

Use Cache for data that:

- Can be regenerated or lost without user impact
- Needs no backup or cross-device sync
- Has lifecycle tied to a component, window, or app session

For user settings use [Preference](./preference-overview.md); for business data use [DataApi](./data-api-overview.md).

## Tiers

| Tier       | Scope                       | Survives restart | Authority                        | Use for                                 |
| ---------- | --------------------------- | ---------------- | -------------------------------- | --------------------------------------- |
| Memory     | Per-process                 | No               | Local to each process            | Computed results, API responses         |
| Shared     | All renderer windows + Main | No               | Main (relays + conflict sink)    | Cross-window UI state                   |
| Persist (Renderer) | All renderer windows | Yes (localStorage) | Each renderer                | Recent items, non-critical UI state |
| Persist (Main)     | Main process only    | Yes (JSON file)    | Main                         | Loseable main-process state         |

Persist has two **independent** stores. Each **renderer** persists to its own `localStorage`; **Main** persists to its own JSON file (`{userData}/cache.json`) exposed as `getPersist` / `setPersist` / `hasPersist` / `deletePersist` (plus `subscribePersistChange`) on the Main `CacheService`. The two never share data — Main cannot read renderer persist and vice versa. Separately, Main still **relays** renderer-origin `CacheSyncMessage { type: 'persist' }` between windows (it forwards them; it does not store the renderer's persist).

> **Reach for the Main persist tier last.** It was the last tier added, for a deliberately narrow need: small, loseable, **main-process-authoritative** state that genuinely belongs nowhere else. Before choosing it, rule out the better-fitting systems first — a user setting belongs in [Preference](./preference-overview.md); cross-window or renderer-owned UI state belongs in Shared / renderer Persist; business data belongs in [DataApi](./data-api-overview.md). In the vast majority of cases one of those is the right answer, so use Main persist only when the state is owned by the main process, regenerable, and has no home in any other system. See [System Selection](./README.md) for the full decision guide.

## Key Types

| Type     | Example schema                       | Call site                                 | Tiers            |
| -------- | ------------------------------------ | ----------------------------------------- | ---------------- |
| Fixed    | `'app.user.avatar': string`          | `get('app.user.avatar')`                  | Memory / Shared / Persist |
| Template | `'scroll.position.${topicId}': number` | `get('scroll.position.t42')`            | Memory / Shared  |
| Casual   | (none — type argument only)          | `getCasual<T>('my.dynamic.key')`          | Memory only      |

Template keys share one default value across all instances — all `web_search.provider.last_used_key.*` fall back to `''`. Casual keys are blocked at compile time from matching any schema pattern (`UseCacheCasualKey` in `src/shared/data/cache/cacheSchemas.ts:393`).

## Design Invariants

Non-obvious rules the code enforces; assume them when designing consumers.

1. **Same-value write is a no-op.** Equality via `isEqual` (es-toolkit/compat). No broadcast, no subscriber fire, no hook re-render. (`src/main/data/CacheService.ts` `isEqual` guards before `broadcastSync` / notifier) — Corollary for the hooks' functional updater `setX(prev => …)`: it must return a **new** value. Mutating `prev` in place and returning the same reference compares the stored value against itself, so this no-op short-circuit silently swallows the update (the hooks type `prev` shallow-readonly to block the common top-level case).
2. **TTL-only refresh does not fire subscribers.** Updating `expireAt` on the same value is silent.
3. **Subscribers fire only on explicit writes.** Lazy TTL cleanup, the 10-min GC sweep, and `onStop` do not fire.
4. **Hooks + TTL is discouraged.** `useCache` / `useSharedCache` log a warn when the key has TTL (`src/renderer/data/hooks/useCache.ts:186-192,289-295`) — values can expire between renders.
5. **Hooks pin cache entries.** `registerHook` / `unregisterHook` refcount keys; `delete` / `deleteShared` return `false` while any hook is active.
6. **Persist presence means "overridden", not "stored".** Both persist tiers (Main JSON + renderer localStorage) have no absent state — `getPersist` always returns the stored override or the schema default (never undefined). `hasPersist` reports whether the effective value *differs from the default* (i.e. has been overridden), and `deletePersist` resets a key to its default rather than removing it. Keys are fixed by schema. Change subscription differs by process in API shape only: Main exposes a dedicated `subscribePersistChange` (main-local, same model as `subscribeChange`; never relayed to renderers), while the renderer routes persist changes through its unified `subscribe(key, cb)`.
7. **TTL uses absolute `expireAt` (Unix ms).** Every process expires the same entry at the same instant, regardless of clock skew in IPC delivery.
8. **Main-wins convergence.** All cross-window shared writes are serialized through Main; on window init, Main-priority override applies to conflicts with the renderer's pre-sync copy.
9. **Re-entrant callbacks are safe.** Subscribers may write back into the same key; the `isEqual` short-circuit terminates loops once the value stabilizes. Callback errors are caught and logged without skipping other subscribers.
10. **Template placeholders are runtime-anonymous.** `${providerId}` and `${foo}` match identical concrete keys. Dynamic segments match `[\w\-]+` only — dots, colons, and non-ASCII are rejected (`src/shared/data/cache/templateKey.ts:35-46`).

## Architecture

```
┌─────────────────────── Renderer Process ──────────────────────┐
│   useCache / useSharedCache / usePersistCache                 │
│                          │                                    │
│                          ▼                                    │
│                   CacheService (Renderer)                     │
│   - Memory cache (local)                                      │
│   - Shared cache (local copy; init-synced from Main)          │
│   - Persist cache (localStorage, authoritative)               │
└──────────────────────────┬────────────────────────────────────┘
                           │ IPC: Cache_Sync / Cache_GetAllShared
┌──────────────────────────▼────────────────────────────────────┐
│                    CacheService (Main)                        │
│   - Internal cache (Main-only)                                │
│   - Shared cache (authoritative; relays to all windows)       │
│   - Persist: own JSON store + relays renderer persist         │
│   - subscribeChange / subscribeSharedChange for Main services │
└───────────────────────────────────────────────────────────────┘
```

## Process Responsibilities

| Concern                         | Main                                             | Renderer                                             |
| ------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| Internal memory cache           | Yes (services' own scratch space)                | Yes (window-local)                                   |
| Shared cache authority          | Yes                                              | Local copy; writes broadcast via IPC to Main         |
| Persist cache storage           | Yes (own JSON file, debounced 350ms, flush on stop); also relays renderer persist sync | Yes (localStorage, debounced 350ms, flush on unload) |
| Init sync for new windows       | Serves `getAllShared()`                          | Calls `getAllShared()` on startup                    |
| `subscribeChange` / `subscribeSharedChange` | Main-only API; template-aware | —                                                    |
| Hook refcounting                | —                                                | `registerHook` / `unregisterHook`                    |
| GC (10-min sweep of expired)    | Yes                                              | —                                                    |

## API Reference

### Renderer

| Method                                               | Tier    | Key type                |
| ---------------------------------------------------- | ------- | ----------------------- |
| `useCache` / `get` / `set` / `has` / `delete` / `hasTTL` | Memory  | Fixed + Template        |
| `getCasual` / `setCasual` / `hasCasual` / `deleteCasual` / `hasTTLCasual` | Memory | Dynamic only (schema keys blocked) |
| `useSharedCache` / `getShared` / `setShared` / `hasShared` / `deleteShared` / `hasSharedTTL` | Shared | Fixed + Template |
| `usePersistCache` / `getPersist` / `setPersist` / `hasPersist` / `deletePersist` | Persist | Fixed only |
| `isSharedCacheReady` / `onSharedCacheReady`          | Shared  | —                       |
| `getStats(includeDetails?: boolean)`                 | All     | —                       |

### Main

| Method                                               | Tier    | Key type                |
| ---------------------------------------------------- | ------- | ----------------------- |
| `get` / `set` / `has` / `delete`                     | Internal | Free-form string        |
| `getShared` / `setShared` / `hasShared` / `deleteShared` | Shared | Fixed + Template        |
| `getPersist` / `setPersist` / `hasPersist` / `deletePersist` | Persist (Main) | Fixed only |
| `subscribeChange<T>(key, cb)`                        | Internal | Exact key               |
| `subscribeSharedChange<K>(key, cb)`                  | Shared  | Fixed + Template (fires for every matching concrete instance) |
| `subscribePersistChange<K>(key, cb)`                 | Persist (Main) | Exact key (main-local)  |

## See Also

- [Cache Usage](./cache-usage.md) — React hooks, direct API, patterns
- [Cache Schema Guide](./cache-schema-guide.md) — Adding fixed and template keys
- Source: `src/main/data/CacheService.ts`, `src/renderer/data/CacheService.ts`, `src/renderer/data/hooks/useCache.ts`, `src/shared/data/cache/`
