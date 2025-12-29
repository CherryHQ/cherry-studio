# Cache Usage Guide

This guide covers how to use the Cache system in React components and services.

## React Hooks

### useCache (Memory Cache)

Memory cache is lost on app restart. Best for temporary computed results.

```typescript
import { useCache } from '@data/hooks/useCache'

// Basic usage with default value
const [counter, setCounter] = useCache('ui.counter', 0)

// Update the value
setCounter(counter + 1)

// With TTL (30 seconds)
const [searchResults, setSearchResults] = useCache('search.results', [], { ttl: 30000 })
```

### useSharedCache (Cross-Window Cache)

Shared cache syncs across all windows, lost on app restart.

```typescript
import { useSharedCache } from '@data/hooks/useCache'

// Cross-window state
const [layout, setLayout] = useSharedCache('window.layout', defaultLayout)

// Sidebar state shared between windows
const [sidebarCollapsed, setSidebarCollapsed] = useSharedCache('ui.sidebar.collapsed', false)
```

### usePersistCache (Persistent Cache)

Persist cache survives app restarts via localStorage.

```typescript
import { usePersistCache } from '@data/hooks/useCache'

// Recent files list (survives restart)
const [recentFiles, setRecentFiles] = usePersistCache('app.recent_files', [])

// Search history
const [searchHistory, setSearchHistory] = usePersistCache('search.history', [])
```

## CacheService Direct Usage

For non-React code or more control, use CacheService directly.

### Memory Cache

```typescript
import { cacheService } from '@data/CacheService'

// Type-safe (schema key)
cacheService.set('temp.calculation', result)
const result = cacheService.get('temp.calculation')

// With TTL (30 seconds)
cacheService.set('temp.calculation', result, 30000)

// Casual (dynamic key, manual type)
cacheService.setCasual<TopicCache>(`topic:${id}`, topicData)
const topic = cacheService.getCasual<TopicCache>(`topic:${id}`)

// Check existence
if (cacheService.has('temp.calculation')) {
  // ...
}

// Delete
cacheService.delete('temp.calculation')
cacheService.deleteCasual(`topic:${id}`)
```

### Shared Cache

```typescript
// Type-safe (schema key)
cacheService.setShared('window.layout', layoutConfig)
const layout = cacheService.getShared('window.layout')

// Casual (dynamic key)
cacheService.setSharedCasual<WindowState>(`window:${windowId}`, state)
const state = cacheService.getSharedCasual<WindowState>(`window:${windowId}`)

// Delete
cacheService.deleteShared('window.layout')
cacheService.deleteSharedCasual(`window:${windowId}`)
```

### Persist Cache

```typescript
// Schema keys only (no Casual methods for persist)
cacheService.setPersist('app.recent_files', recentFiles)
const files = cacheService.getPersist('app.recent_files')

// Delete
cacheService.deletePersist('app.recent_files')
```

## Type-Safe vs Casual Methods

### Type-Safe Methods
- Use predefined keys from cache schema
- Full auto-completion and type inference
- Compile-time key validation

```typescript
// Key 'ui.counter' must exist in schema
const [counter, setCounter] = useCache('ui.counter', 0)
```

### Casual Methods
- Use dynamically constructed keys
- Require manual type specification via generics
- No compile-time key validation

```typescript
// Dynamic key, must specify type
const topic = cacheService.getCasual<TopicCache>(`topic:${id}`)
```

### When to Use Which

| Scenario | Method | Example |
|----------|--------|---------|
| Fixed cache keys | Type-safe | `useCache('ui.counter')` |
| Entity caching by ID | Casual | `getCasual<Topic>(\`topic:${id}\`)` |
| Session-based keys | Casual | `setCasual(\`session:${sessionId}\`)` |
| UI state | Type-safe | `useSharedCache('window.layout')` |

## Common Patterns

### Caching Expensive Computations

```typescript
function useExpensiveData(input: string) {
  const [cached, setCached] = useCache(`computed:${input}`, null)

  useEffect(() => {
    if (cached === null) {
      const result = expensiveComputation(input)
      setCached(result)
    }
  }, [input, cached, setCached])

  return cached
}
```

### Cross-Window Coordination

```typescript
// Window A: Update shared state
const [activeFile, setActiveFile] = useSharedCache('editor.activeFile', null)
setActiveFile(selectedFile)

// Window B: Reacts to change automatically
const [activeFile] = useSharedCache('editor.activeFile', null)
// activeFile updates when Window A changes it
```

### Recent Items with Limit

```typescript
const [recentItems, setRecentItems] = usePersistCache('app.recentItems', [])

const addRecentItem = (item: Item) => {
  setRecentItems(prev => {
    const filtered = prev.filter(i => i.id !== item.id)
    return [item, ...filtered].slice(0, 10) // Keep last 10
  })
}
```

### Cache with Expiration Check

```typescript
interface CachedData<T> {
  data: T
  timestamp: number
}

function useCachedWithExpiry<T>(key: string, fetcher: () => Promise<T>, maxAge: number) {
  const [cached, setCached] = useCache<CachedData<T> | null>(key, null)
  const [data, setData] = useState<T | null>(cached?.data ?? null)

  useEffect(() => {
    const isExpired = !cached || Date.now() - cached.timestamp > maxAge

    if (isExpired) {
      fetcher().then(result => {
        setCached({ data: result, timestamp: Date.now() })
        setData(result)
      })
    }
  }, [key, maxAge])

  return data
}
```

## Adding New Cache Keys

### 1. Add to Cache Schema

```typescript
// packages/shared/data/cache/cacheSchemas.ts
export interface CacheSchema {
  // Existing keys...
  'myFeature.data': MyDataType
}
```

### 2. Define Value Type (if complex)

```typescript
// packages/shared/data/cache/cacheValueTypes.ts
export interface MyDataType {
  items: string[]
  lastUpdated: number
}
```

### 3. Use in Code

```typescript
// Now type-safe
const [data, setData] = useCache('myFeature.data', defaultValue)
```

## Best Practices

1. **Choose the right tier**: Memory for temp, Shared for cross-window, Persist for survival
2. **Use TTL for stale data**: Prevent serving outdated cached values
3. **Prefer type-safe keys**: Add to schema when possible
4. **Clean up dynamic keys**: Remove casual cache entries when no longer needed
5. **Consider data size**: Persist cache uses localStorage (limited to ~5MB)
