# Cache Usage Guide

Concept and invariants: [cache-overview.md](./cache-overview.md). Adding keys: [cache-schema-guide.md](./cache-schema-guide.md).

## React Hooks

Import from `@data/hooks/useCache`.

| Hook                     | Tier    | Signature                                                                            |
| ------------------------ | ------- | ------------------------------------------------------------------------------------ |
| `useCache`               | Memory  | `(key: UseCacheKey, initValue?: V) => [V, (next: V \| ((prev) => V)) => void]`        |
| `useSharedCache`         | Shared  | `(key: SharedCacheKey, initValue?: V) => [V, (next: V \| ((prev) => V)) => void]`     |
| `useSharedCacheValue`    | Shared  | `(key: SharedCacheKey) => V \| undefined` — read-only observer                        |
| `useSharedCacheSelector` | Shared  | `(keys: SharedCacheKey[], selector: (values) => S, isEqual?) => S` — multi-key read-only aggregate |
| `usePersistCache`        | Persist | `(key: RendererPersistCacheKey) => [V, (next: V \| ((prev) => V)) => void]`           |

Value type is inferred from the schema. The writable hooks pin the cache entry (refcounted) — the key cannot be `delete`d while any hook is mounted; `useSharedCacheValue` does NOT pin (and never writes a default), so an owner's deletion always passes through. Hooks do **not** accept a TTL option; using TTL under a writable hook logs a warning and is discouraged (see [Design Invariant #4](./cache-overview.md#design-invariants)).

**Pick the shared hook by writer provenance.** If this window writes the key, use `useSharedCache`. If another process owns it (typically a Main service publishing via `setShared`) and this window only displays it, use `useSharedCacheValue` — mounting the writable hook seeds the schema default back into the cache and broadcasts it, which can clobber the owner's value during the mount race. Apply `?? fallback` with a reference-stable default (module-level const, or an unconditionally evaluated `useMemo` — never a hook call on the right side of `??`).

The setter accepts a concrete value **or a functional updater** `(prev) => next`, like React's `useState`. The updater resolves against the **latest stored value** at write time (not the render-time snapshot), so read-modify-write stays correct across an `await` — prefer it whenever the next value derives from the current one. `prev` is shallow-readonly: the updater MUST be pure and return a new value (mutating `prev` in place is short-circuited by `isEqual` and silently skips the re-render — see [Design Invariant #1](./cache-overview.md#design-invariants)). Keep it side-effect-free too: don't smuggle a derived value out of the updater (e.g. into an outer variable) to drive post-write work, and don't rely on how often or when it runs — to react to *what changed* (e.g. dispose resources for removed items), derive it in a `useEffect` that watches the value. For `useSharedCache` the updater resolves against the local window's value only; it is not cross-window atomic.

```typescript
import { useCache, useSharedCache, useSharedCacheValue, usePersistCache } from '@data/hooks/useCache'

// Memory — single renderer
const [generating, setGenerating] = useCache('chat.web_search.searching', false)

// Shared — all windows
const [activeSearches, setActive] = useSharedCache('chat.web_search.active_searches')

// Shared, main-owned — read-only observation with a reference-stable fallback
const EMPTY_JOB_PROGRESS: JobProgress = { progress: 0 }
const progress = useSharedCacheValue(`jobs.progress.${jobId}`) ?? EMPTY_JOB_PROGRESS

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

To observe a shared value reactively, use a hook; for an imperative one-shot read, use the TTL-aware `getShared`. There is no consumer API for TTL-blind physical reads — the hooks' internal snapshot reader is not for business code.

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

Main does not expose casual methods. Main has its own persist storage — an independent JSON file (`{userData}/cache.json`) accessed via `getPersist` / `setPersist` / `hasPersist`, separate from the renderer's `localStorage` persist and never shared with it. Renderer-origin persist sync still goes through Main as an IPC relay only.

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
- Same-value writes are suppressed (`isEqual` from es-toolkit/compat)
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
// Window A — functional updater derives from this window's latest local value
const [active, setActive] = useSharedCache('chat.web_search.active_searches')
setActive((prev) => ({ ...prev, [searchId]: state }))

// Window B re-renders automatically on next Main relay. It only displays the
// value, so it observes read-only — no default seeding, no pin.
const EMPTY_SEARCHES: ActiveSearches = {} // module-level: reference-stable fallback
const active = useSharedCacheValue('chat.web_search.active_searches') ?? EMPTY_SEARCHES
```

### Observe a main-owned key (read-only)

Main publishes; this window only displays. The writable hook would seed the
schema default back (clobbering the owner during the mount race) and pin the
key — use the read-only observer with a reference-stable local fallback:

```typescript
const EMPTY_JOB_PROGRESS: JobProgress = { progress: 0 }

function useJobProgress(jobId: string): JobProgress {
  return useSharedCacheValue(`jobs.progress.${jobId}` as const) ?? EMPTY_JOB_PROGRESS
}

// Fallback depends on props? Evaluate the hook UNCONDITIONALLY, then `??`:
const cached = useSharedCacheValue(key)
const fallback = useMemo(() => getDefaultStatus(isActive), [isActive])
return cached ?? fallback // never: cached ?? useMemo(...) — conditional hook call
```

### Aggregate multiple main-owned keys (read-only selector)

A dynamic number of keys cannot be observed with per-key hooks (Rules of Hooks
forbid hooks in loops). When N values must merge into one derived result, use
`useSharedCacheSelector`: `keys` is both the subscription set and the only
snapshot read set; the selector receives the matching values tuple (same order,
`undefined` on miss) and must not touch `cacheService` itself:

```typescript
const EMPTY_TOOLS: McpTool[] = [] // module-level: reference-stable fallback

function useMcpToolsByServer(serverIds: readonly string[]): Record<string, McpTool[]> {
  // Derive keys AND the zip source from the same memoized array
  const uniqueIds = useMemo(() => Array.from(new Set(serverIds)).sort(), [serverIds])
  return useSharedCacheSelector(
    uniqueIds.map((id) => `mcp.tools.${id}` as const), // no extra useMemo needed
    (values) => Object.fromEntries(uniqueIds.map((id, i): [string, McpTool[]] => [id, values[i] ?? EMPTY_TOOLS]))
  )
}
```

`isEqual` (default: `Object.is` plus one level of item-wise comparison for
arrays/plain objects) gates re-renders at the selection level;
`Map`/`Set` or domain-value selections need an explicit comparator. Same
zero-side-effect contract as `useSharedCacheValue`: no default write-back, no
pin. See the hook's JSDoc in `useCache.ts` for the full consumer discipline.

### Bounded recent list (Persist)

```typescript
const [pinned, setPinned] = usePersistCache('ui.tab.pinned_tabs')
// Functional updater derives from the latest stored value — correct even if
// pin() races another write (e.g. fires after an await).
const pin = (tab: Tab) =>
  setPinned((prev) => [tab, ...prev.filter((t) => t.id !== tab.id)].slice(0, 10))
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
3. Pick the shared hook by writer provenance: this window writes → `useSharedCache`; another process owns the key and this window only displays → `useSharedCacheValue` with a reference-stable `??` fallback. Shared expiry is eventually consistent — an observed value may briefly outlive its TTL until Main's tombstone lands (see [Design Invariant #4](./cache-overview.md#design-invariants)).
4. Prefer Fixed > Template > Casual. Promote recurring casual keys to Template.
5. Keep Persist values small — localStorage is ~5MB per origin.
6. For Main-process reactions to cache changes, always wrap the `subscribe*` return in `this.registerDisposable(...)` so teardown is automatic.
7. Same-value writes are free — don't add your own equality guards around `set` / `setShared`.
