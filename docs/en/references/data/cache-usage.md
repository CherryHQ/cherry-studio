# Cache Usage Guide

This guide covers how to use the Cache system in React components and services.

## React Hooks

### useCache (Memory Cache)

Memory cache is lost on app restart. Best for temporary computed results.

```typescript
import { useCache } from "@data/hooks/useCache";

// Basic usage with default value
const [counter, setCounter] = useCache("ui.counter", 0);

// Update the value
setCounter(counter + 1);

// With TTL (30 seconds)
const [searchResults, setSearchResults] = useCache("search.results", [], {
  ttl: 30000,
});
```

### useSharedCache (Cross-Window Cache)

Shared cache syncs across all windows, lost on app restart.

```typescript
import { useSharedCache } from "@data/hooks/useCache";

// Cross-window state
const [layout, setLayout] = useSharedCache("window.layout", defaultLayout);

// Sidebar state shared between windows
const [sidebarCollapsed, setSidebarCollapsed] = useSharedCache(
  "ui.sidebar.collapsed",
  false
);
```

### usePersistCache (Persistent Cache)

Persist cache survives app restarts via localStorage.

```typescript
import { usePersistCache } from "@data/hooks/useCache";

// Recent files list (survives restart)
const [recentFiles, setRecentFiles] = usePersistCache("app.recent_files", []);

// Search history
const [searchHistory, setSearchHistory] = usePersistCache("search.history", []);
```

## CacheService Direct Usage

For non-React code or more control, use CacheService directly.

### Memory Cache

```typescript
import { cacheService } from "@data/CacheService";

// Type-safe (schema key)
cacheService.set("temp.calculation", result);
const result = cacheService.get("temp.calculation");

// With TTL (30 seconds)
cacheService.set("temp.calculation", result, 30000);

// Casual (dynamic key, manual type)
cacheService.setCasual<TopicCache>(`topic:${id}`, topicData);
const topic = cacheService.getCasual<TopicCache>(`topic:${id}`);

// Check existence
if (cacheService.has("temp.calculation")) {
  // ...
}

// Delete
cacheService.delete("temp.calculation");
cacheService.deleteCasual(`topic:${id}`);
```

### Shared Cache

```typescript
// Type-safe (schema key)
cacheService.setShared("window.layout", layoutConfig);
const layout = cacheService.getShared("window.layout");

// Casual (dynamic key)
cacheService.setSharedCasual<WindowState>(`window:${windowId}`, state);
const state = cacheService.getSharedCasual<WindowState>(`window:${windowId}`);

// Delete
cacheService.deleteShared("window.layout");
cacheService.deleteSharedCasual(`window:${windowId}`);
```

### Persist Cache

```typescript
// Schema keys only (no Casual methods for persist)
cacheService.setPersist("app.recent_files", recentFiles);
const files = cacheService.getPersist("app.recent_files");

// Delete
cacheService.deletePersist("app.recent_files");
```

## Main Process Usage

Main process CacheService provides SharedCache for cross-window state management.

### SharedCache in Main Process

```typescript
import { cacheService } from "@main/data/CacheService";

// Type-safe (schema key) - matches Renderer's type system
cacheService.setShared("window.layout", layoutConfig);
const layout = cacheService.getShared("window.layout");

// With TTL (30 seconds)
cacheService.setShared("temp.state", state, 30000);

// Check existence
if (cacheService.hasShared("window.layout")) {
  // ...
}

// Delete
cacheService.deleteShared("window.layout");
```

**Note**: Main CacheService does NOT support Casual methods (`getSharedCasual`, etc.). Only schema-based type-safe access is available in Main process.

### Sync Strategy

- **Renderer → Main**: When Renderer calls `setShared()`, it broadcasts to Main via IPC. Main updates its SharedCache and relays to other windows.
- **Main → Renderer**: When Main calls `setShared()`, it broadcasts to all Renderer windows.
- **New Window Initialization**: New windows fetch complete SharedCache state from Main via `getAllShared()`. Uses Main-priority override strategy for conflicts.

## Type-Safe vs Casual Methods

### Type-Safe Methods

- Use predefined keys from cache schema
- Full auto-completion and type inference
- Compile-time key validation

```typescript
// Key 'ui.counter' must exist in schema
const [counter, setCounter] = useCache("ui.counter", 0);
```

### Casual Methods

- Use dynamically constructed keys
- Require manual type specification via generics
- No compile-time key validation
- **Cannot use keys that match schema patterns** (including template keys)

```typescript
// Dynamic key, must specify type
const topic = cacheService.getCasual<TopicCache>(`my.custom.key`);

// Compile error: cannot use schema keys with Casual methods
cacheService.getCasual("app.user.avatar"); // Error: matches fixed key
cacheService.getCasual("scroll.position.topic123"); // Error: matches template key
```

### Template Keys

Template keys provide type-safe caching for dynamic key patterns. Define a template in the schema using `${variable}` syntax, and TypeScript will automatically match and infer types for concrete keys.

**Important**: Template keys follow the same dot-separated naming pattern as fixed keys. When `${xxx}` is treated as a literal string, the key must match the format: `xxx.yyy.zzz_www`

#### Defining Template Keys

```typescript
// packages/shared/data/cache/cacheSchemas.ts
export type UseCacheSchema = {
  // Fixed key
  "app.user.avatar": string;

  // Template keys - use ${variable} for dynamic segments
  // Must follow dot-separated pattern like fixed keys
  "scroll.position.${topicId}": number;
  "entity.cache.${type}_${id}": EntityData;
};

// Default values for templates (shared by all instances)
export const DefaultUseCache: UseCacheSchema = {
  "app.user.avatar": "",
  "scroll.position.${topicId}": 0,
  "entity.cache.${type}_${id}": { loaded: false },
};
```

#### Using Template Keys

```typescript
// TypeScript infers the value type from schema
const [scrollPos, setScrollPos] = useCache("scroll.position.topic123");
// scrollPos is inferred as `number`

const [entity, setEntity] = useCache("entity.cache.user_456");
// entity is inferred as `EntityData`

// Direct CacheService usage
cacheService.set("scroll.position.mytopic", 150); // OK: value must be number
cacheService.set("scroll.position.mytopic", "hi"); // Error: type mismatch
```

#### Template Key Benefits

| Feature                 | Fixed Keys   | Template Keys          | Casual Methods |
| ----------------------- | ------------ | ---------------------- | -------------- |
| Type inference          | ✅ Automatic | ✅ Automatic           | ❌ Manual      |
| Auto-completion         | ✅ Full      | ✅ Partial (prefix)    | ❌ None        |
| Compile-time validation | ✅ Yes       | ✅ Yes                 | ❌ No          |
| Dynamic IDs             | ❌ No        | ✅ Yes                 | ✅ Yes         |
| Default values          | ✅ Yes       | ✅ Shared per template | ❌ No          |

### When to Use Which

| Scenario                        | Method       | Example                                 |
| ------------------------------- | ------------ | --------------------------------------- |
| Fixed cache keys                | Type-safe    | `useCache('ui.counter')`                |
| Dynamic keys with known pattern | Template key | `useCache('scroll.position.topic123')`  |
| Entity caching by ID            | Template key | `get('entity.cache.user_456')`          |
| Completely dynamic keys         | Casual       | `getCasual<T>(\`custom.dynamic.${x}\`)` |
| UI state                        | Type-safe    | `useSharedCache('window.layout')`       |

## Common Patterns

### Caching Expensive Computations

```typescript
function useExpensiveData(input: string) {
  const [cached, setCached] = useCache(`computed:${input}`, null);

  useEffect(() => {
    if (cached === null) {
      const result = expensiveComputation(input);
      setCached(result);
    }
  }, [input, cached, setCached]);

  return cached;
}
```

### Cross-Window Coordination

```typescript
// Window A: Update shared state
const [activeFile, setActiveFile] = useSharedCache("editor.activeFile", null);
setActiveFile(selectedFile);

// Window B: Reacts to change automatically
const [activeFile] = useSharedCache("editor.activeFile", null);
// activeFile updates when Window A changes it
```

### Recent Items with Limit

```typescript
const [recentItems, setRecentItems] = usePersistCache("app.recentItems", []);

const addRecentItem = (item: Item) => {
  setRecentItems((prev) => {
    const filtered = prev.filter((i) => i.id !== item.id);
    return [item, ...filtered].slice(0, 10); // Keep last 10
  });
};
```

### Cache with Expiration Check

```typescript
interface CachedData<T> {
  data: T;
  timestamp: number;
}

function useCachedWithExpiry<T>(
  key: string,
  fetcher: () => Promise<T>,
  maxAge: number
) {
  const [cached, setCached] = useCache<CachedData<T> | null>(key, null);
  const [data, setData] = useState<T | null>(cached?.data ?? null);

  useEffect(() => {
    const isExpired = !cached || Date.now() - cached.timestamp > maxAge;

    if (isExpired) {
      fetcher().then((result) => {
        setCached({ data: result, timestamp: Date.now() });
        setData(result);
      });
    }
  }, [key, maxAge]);

  return data;
}
```

## Adding New Cache Keys

### Adding Fixed Keys

#### 1. Add to Cache Schema

```typescript
// packages/shared/data/cache/cacheSchemas.ts
export type UseCacheSchema = {
  // Existing keys...
  "myFeature.data": MyDataType;
};

export const DefaultUseCache: UseCacheSchema = {
  // Existing defaults...
  "myFeature.data": { items: [], lastUpdated: 0 },
};
```

#### 2. Define Value Type (if complex)

```typescript
// packages/shared/data/cache/cacheValueTypes.ts
export interface MyDataType {
  items: string[];
  lastUpdated: number;
}
```

#### 3. Use in Code

```typescript
// Now type-safe
const [data, setData] = useCache("myFeature.data");
```

### Adding Template Keys

#### 1. Add Template to Schema

```typescript
// packages/shared/data/cache/cacheSchemas.ts
export type UseCacheSchema = {
  // Existing keys...
  // Template key with dynamic segment
  "scroll.position.${topicId}": number;
};

export const DefaultUseCache: UseCacheSchema = {
  // Existing defaults...
  // Default shared by all instances of this template
  "scroll.position.${topicId}": 0,
};
```

#### 2. Use in Code

```typescript
// TypeScript infers number from template pattern
const [scrollPos, setScrollPos] = useCache(`scroll.position.${topicId}`);

// Works with any string in the dynamic segment
const [pos1, setPos1] = useCache("scroll.position.topic123");
const [pos2, setPos2] = useCache("scroll.position.conversationabc");
```

### Key Naming Convention

All keys (fixed and template) must follow the same naming convention:

- **Format**: `namespace.sub.key_name` (template `${xxx}` treated as a literal string segment)
- **Rules**:
  - Start with lowercase letter
  - Use lowercase letters, numbers, and underscores
  - Separate segments with dots (`.`)
  - Template placeholders `${xxx}` are treated as literal string segments
- **Examples**:
  - ✅ `app.user.avatar`
  - ✅ `scroll.position.${id}`
  - ✅ `entity.cache.${type}_${id}`
  - ❌ `scroll.position:${id}` (colon not allowed)
  - ❌ `UserAvatar` (no dots)
  - ❌ `App.User` (uppercase)

## Shared Cache Ready State

Renderer CacheService provides ready state tracking for SharedCache initialization sync.

```typescript
import { cacheService } from "@data/CacheService";

// Check if shared cache is ready
if (cacheService.isSharedCacheReady()) {
  // SharedCache has been synced from Main
}

// Register callback when ready
const unsubscribe = cacheService.onSharedCacheReady(() => {
  // Called immediately if already ready, or when sync completes
  console.log("SharedCache ready!");
});

// Cleanup
unsubscribe();
```

**Behavior notes**:

- `getShared()` returns `undefined` before ready (expected behavior)
- `setShared()` works immediately and broadcasts to Main (Main updates its cache)
- Hooks like `useSharedCache` work normally - they set initial values and update when sync completes
- Main-priority override: when sync completes, Main's values override local values

## Cache Statistics

For debugging purposes, CacheService provides a `getStats()` method to inspect cache state:

```typescript
// Get summary statistics
const stats = cacheService.getStats();

// Get detailed per-entry information
const fullStats = cacheService.getStats(true);
```

Returns statistics including entry counts, TTL status, hook references, and estimated memory usage for all cache tiers (memory, shared, persist).

## Best Practices

1. **Choose the right tier**: Memory for temp, Shared for cross-window, Persist for survival
2. **Use TTL for stale data**: Prevent serving outdated cached values
3. **Prefer type-safe keys**: Add to schema when possible
4. **Use template keys for patterns**: When you have a recurring pattern (e.g., caching by ID), define a template key instead of using casual methods
5. **Reserve casual for truly dynamic keys**: Only use casual methods when the key pattern is completely unknown at development time
6. **Clean up dynamic keys**: Remove casual cache entries when no longer needed
7. **Consider data size**: Persist cache uses localStorage (limited to ~5MB)
8. **Use absolute timestamps for sync**: CacheSyncMessage uses `expireAt` (absolute Unix timestamp) for precise cross-window TTL sync
