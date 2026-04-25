# Cache Usage Guide

Concept and invariants: [cache-overview.md](./cache-overview.md). Adding keys: [cache-schema-guide.md](./cache-schema-guide.md).

## React Hooks

Import from `@data/hooks/useCache`.

| Hook              | Tier    | Signature                                                                   |
| ----------------- | ------- | --------------------------------------------------------------------------- |
| `useCache`        | Memory  | `(key: UseCacheKey, initValue?: V) => [V, (next: V) => void]`               |
| `useSharedCache`  | Shared  | `(key: SharedCacheKey, initValue?: V) => [V, (next: V) => void]`            |
| `usePersistCache` | Persist | `(key: RendererPersistCacheKey) => [V, (next: V) => void]`                  |

Value type is inferred from the schema. Hooks pin the cache entry (refcounted) — the key cannot be `delete`d while any hook is mounted. Hooks do **not** accept a TTL option; using TTL under a hook logs a warning and is discouraged (see [Design Invariant #4](./cache-overview.md#design-invariants)).

```typescript
import { useCache, useSharedCache, usePersistCache } from '@data/hooks/useCache'

// Memory — single renderer
const [generating, setGenerating] = useCache('chat.web_search.searching', false)

// Shared — all windows
const [activeSearches, setActive] = useSharedCache('chat.web_search.active_searches')

// Persist — survives restart via localStorage
const [pinned, setPinned] = usePersistCache('ui.tab.pinned_tabs')

// Template key (schema: 'scroll.position.${topicId}': number)
const [scrollPos, setScrollPos] = useCache(`scroll.position.${topicId}`)
```

## CacheService Direct Usage (Renderer)

Import the singleton:

```typescript
import { cacheService } from '@data/CacheService'
```

### Memory

```typescript
// Schema keys (Fixed or Template) — type-inferred
cacheService.set('chat.web_search.searching', true)
cacheService.set('chat.web_search.searching', true, 30_000)          // with TTL (ms)
cacheService.get('chat.web_search.searching')                         // boolean
cacheService.has('chat.web_search.searching')
cacheService.hasTTL('chat.web_search.searching')
cacheService.delete('chat.web_search.searching')

// Casual (Memory tier only, no schema match allowed)
cacheService.setCasual<TopicCache>(`topic:${id}`, data, 30_000)
cacheService.getCasual<TopicCache>(`topic:${id}`)
cacheService.hasCasual(`topic:${id}`)
cacheService.hasTTLCasual(`topic:${id}`)
cacheService.deleteCasual(`topic:${id}`)
```

### Shared

```typescript
// Fixed key
cacheService.setShared('chat.web_search.active_searches', map)
cacheService.getShared('chat.web_search.active_searches')

// Template key (schema: 'web_search.provider.last_used_key.${providerId}': string)
const k = `web_search.provider.last_used_key.${providerId}` as const
cacheService.setShared(k, 'api-key-id-1')
cacheService.getShared(k)

cacheService.hasShared(k)
cacheService.hasSharedTTL(k)
cacheService.deleteShared(k)
```

Before the initial sync from Main completes, `getShared()` returns `undefined`. Writes before sync are applied locally and broadcast; Main-priority override applies at sync time (see [Shared Cache Ready State](#shared-cache-ready-state)).

### Persist

```typescript
cacheService.setPersist('ui.sidebar.width', 300)
cacheService.getPersist('ui.sidebar.width')
cacheService.hasPersist('ui.sidebar.width')
// No deletePersist — Persist keys are fixed by schema
```

Persist writes are debounced (200ms) and flushed on `beforeunload`. localStorage is limited to ~5MB per origin — keep Persist values small.

## Main Process Usage

```typescript
import { application } from '@application'
const cacheService = application.get('CacheService')
```

Main does not expose casual methods or Persist storage. Persist sync goes through Main as an IPC relay only.

### Internal and Shared Access

```typescript
// Internal cache (Main-only; free-form string keys)
cacheService.set('myService.scratch', value, 30_000)
cacheService.get<MyType>('myService.scratch')

// Shared cache (schema-typed; authoritative at Main)
cacheService.setShared('chat.web_search.active_searches', map)
cacheService.getShared('chat.web_search.active_searches')
cacheService.hasShared('chat.web_search.active_searches')
```

### Subscribing to Changes

```typescript
// Exact key, internal cache
this.registerDisposable(
  cacheService.subscribeChange<number>('myService.counter', (newValue, oldValue) => {
    logger.info('counter changed', { oldValue, newValue })
  })
)

// Exact key, shared cache
this.registerDisposable(
  cacheService.subscribeSharedChange('chat.web_search.active_searches', (newValue, oldValue) => {
    // reacts to writes from any window and from Main itself
  })
)

// Template key — fires for every matching concrete instance
const tpl = 'web_search.provider.last_used_key.${providerId}' as const
this.registerDisposable(
  cacheService.subscribeSharedChange(tpl, (newValue, oldValue, concreteKey) => {
    const providerId = concreteKey.split('.').pop()!
    logger.info(`provider ${providerId} rotated`, { from: oldValue, to: newValue })
  })
)
```

Fire semantics, re-entrance rules, and the placeholder / character-set contract are listed in [cache-overview.md → Design Invariants](./cache-overview.md#design-invariants). In short:

- Fires only on explicit `set` / `delete` / `setShared` / `deleteShared` and renderer-origin writes relayed via IPC
- Never fires immediately on subscribe — call `get()` / `getShared()` yourself for initial state
- Same-value writes are suppressed (`lodash.isEqual`)
- Callback errors are caught; other subscribers still fire

## Shared Cache Ready State

```typescript
if (cacheService.isSharedCacheReady()) {
  // Initial sync from Main has completed
}

const unsubscribe = cacheService.onSharedCacheReady(() => {
  // Fires immediately if already ready, otherwise once sync completes
})
```

Hooks (`useSharedCache`) work correctly before ready — they return the local initValue / schema default until Main's state arrives, then update.

## Cache Statistics (debugging)

```typescript
cacheService.getStats()        // summary: entry counts, TTL status, hook refs, estimated bytes
cacheService.getStats(true)    // per-entry details for every tier
```

## Common Patterns

### Cache an expensive computation

```typescript
function useExpensiveData(input: string) {
  const [cached, setCached] = useCache(`entity.cache.input_${input}`)
  useEffect(() => {
    if (!cached.loaded) setCached({ loaded: true, data: expensiveCompute(input) })
  }, [input, cached, setCached])
  return cached.data
}
```

### Cross-window coordination

```typescript
// Window A
const [active, setActive] = useSharedCache('chat.web_search.active_searches')
setActive({ ...active, [searchId]: state })

// Window B re-renders automatically on next Main relay
const [active] = useSharedCache('chat.web_search.active_searches')
```

### Bounded recent list (Persist)

```typescript
const [pinned, setPinned] = usePersistCache('ui.tab.pinned_tabs')
const pin = (tab: Tab) =>
  setPinned([tab, ...pinned.filter((t) => t.id !== tab.id)].slice(0, 10))
```

### Observe every instance of a template key (Main only)

One subscription covers all providers, including ones registered at runtime:

```typescript
const tpl = 'web_search.provider.last_used_key.${providerId}' as const
this.registerDisposable(
  cacheService.subscribeSharedChange(tpl, (next, prev, concreteKey) => {
    const id = concreteKey.split('.').pop()!
    // react to rotation for provider `id`
  })
)
```

### TTL on a non-hook read path

```typescript
// Main service or non-hook code path
cacheService.set('search.recent_query_hash', hash, 60_000)
// ... check before recomputing
if (!cacheService.has('search.recent_query_hash')) recompute()
```

## Type-Safe vs Casual

| When                                   | Use                                            |
| -------------------------------------- | ---------------------------------------------- |
| Key is known at design time            | Fixed key + type-safe method                   |
| Key has a recurring pattern with a variable part | Template key + type-safe method         |
| Key is truly unknown until runtime     | `getCasual` / `setCasual` (Memory only)        |
| Need cross-window dynamic key          | Template key on Shared tier — there is no `getSharedCasual` |

Casual methods type-error if the concrete key matches any schema pattern — that's intentional.

## Best Practices

1. Pick the tier by lifecycle, not by scope: Memory = regenerable, Shared = cross-window regenerable, Persist = nice-to-keep across restarts.
2. TTL belongs on non-hook read paths; hook paths log a warn and may expire between renders.
3. Prefer Fixed > Template > Casual. Promote recurring casual keys to Template.
4. Keep Persist values small — localStorage is ~5MB per origin.
5. For Main-process reactions to cache changes, always wrap the `subscribe*` return in `this.registerDisposable(...)` so teardown is automatic.
6. Same-value writes are free — don't add your own equality guards around `set` / `setShared`.
