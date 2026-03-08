---
name: v2-renderer
description: Wire up Renderer-process consumption of v2 data via React hooks and services. Covers replacing Redux useAppSelector/dispatch with useQuery/useMutation (DataApi), usePreference (settings), and useCache (temporary data), with multi-window sync considerations. Use when migrating React components from Redux to the v2 data layer.
---

# V2 Renderer: UI Data Consumption (Phase 3 of 3)

Replace Redux `useAppSelector` / `dispatch` in React components with v2 hooks (`useQuery`, `usePreference`, `useCache`) that talk to Main-process services via IPC.

**This skill enforces strict TDD (red-green-refactor).** For every unit of work: (1) write ONE failing test (red), (2) write the minimum code to make it pass (green), (3) refactor while keeping tests green. Repeat. Run `pnpm test:renderer` to verify.

**Related skills:**
- `v2-migrator` - Phase 1: Migrating legacy data into SQLite
- `v2-data-api` - Phase 2: Main-process services that expose data

## Multi-Window Architecture

Cherry Studio has multiple renderer windows (main app, mini window, selection toolbar). Each system handles cross-window sync differently:

| System | Sync Strategy | Notes |
|--------|--------------|-------|
| **DataApiService** | No auto-sync; fetch on demand | Each window fetches fresh data independently |
| **PreferenceService** | Auto-broadcasts to all windows | Main process is source of truth; optimistic updates with rollback |
| **CacheService (shared)** | Auto-broadcasts to all windows | Main maintains authoritative copy; new windows get init-sync |
| **CacheService (persist)** | Auto-broadcasts + localStorage | Survives restarts; Main-priority override on sync |
| **CacheService (memory)** | No sync (process-local) | Isolated per renderer process |

## Migration Pattern: Redux -> v2

### Before (Redux)
```typescript
import { useAppSelector, useAppDispatch } from '@/store'
import { updateSettings } from '@/store/settings'

function SettingsPage() {
  const theme = useAppSelector(state => state.settings.theme)
  const dispatch = useAppDispatch()

  const handleThemeChange = (value: string) => {
    dispatch(updateSettings({ theme: value }))
  }
}
```

### After (v2 - depends on data type)

**User settings -> usePreference:**
```typescript
import { usePreference } from '@data/hooks/usePreference'

function SettingsPage() {
  const [theme, setTheme] = usePreference('app.theme.mode')
  const handleThemeChange = (value: string) => setTheme(value)
}
```

**Business data -> useQuery/useMutation:**
```typescript
import { useQuery, useMutation } from '@data/hooks/useDataApi'

function TopicList() {
  const { data: topics, isLoading } = useQuery('/topics')
  const { trigger: createTopic } = useMutation('POST', '/topics', {
    refresh: ['/topics']
  })
}
```

**Temporary/UI state -> useCache:**
```typescript
import { useSharedCache } from '@data/hooks/useCache'

function Sidebar() {
  const [collapsed, setCollapsed] = useSharedCache('ui.sidebar.collapsed', false)
}
```

## DataApi Hooks (Business Data)

Import from `@data/hooks/useDataApi`.

### useQuery (GET)

```typescript
// Basic list
const { data, isLoading, error, refetch } = useQuery('/topics')

// With query params
const { data } = useQuery('/messages', { query: { topicId, page: 1, limit: 20 } })

// Single resource
const { data: topic } = useQuery('/topics/abc123')

// Conditional fetching (null key = skip)
const { data } = useQuery(topicId ? `/topics/${topicId}/messages` : null)

// Polling
const { data } = useQuery('/topics', { refreshInterval: 5000 })
```

### useMutation (POST/PUT/PATCH/DELETE)

```typescript
// Create
const { trigger: create, isLoading } = useMutation('POST', '/topics', {
  refresh: ['/topics'],  // Auto-refresh these queries after success
  onSuccess: (data) => toast.success('Created'),
})
await create({ body: { name: 'New Topic' } })

// Update (full replace)
const { trigger: replace } = useMutation('PUT', `/topics/${id}`)
await replace({ body: { name: 'Updated', description: '...' } })

// Partial update
const { trigger: update } = useMutation('PATCH', `/topics/${id}`)
await update({ body: { name: 'New Name' } })

// Delete
const { trigger: remove } = useMutation('DELETE', `/topics/${id}`, {
  refresh: ['/topics']
})
await remove()

// Optimistic update (instant UI, auto-rollback on failure)
const { trigger: toggleStar } = useMutation('PATCH', `/topics/${id}`, {
  optimisticData: { ...topic, starred: !topic.starred }
})
```

### useInfiniteQuery (Cursor-based Infinite Scroll)

```typescript
const { items, isLoading, hasNext, loadNext } = useInfiniteQuery('/messages', {
  query: { topicId },
  limit: 20
})
// items: all loaded items flattened
// loadNext(): load next page
```

### usePaginatedQuery (Offset-based Pagination)

```typescript
const { items, page, total, hasNext, hasPrev, nextPage, prevPage } =
  usePaginatedQuery('/topics', { limit: 10 })
```

### Direct Service (non-React)

```typescript
import { dataApiService } from '@data/DataApiService'

const topics = await dataApiService.get('/topics')
const topic = await dataApiService.get('/topics/abc123')
const newTopic = await dataApiService.post('/topics', { body: { name: 'New' } })
await dataApiService.patch('/topics/abc123', { body: { name: 'Updated' } })
await dataApiService.delete('/topics/abc123')
```

### Error Handling

```typescript
// In hooks
const { data, error } = useQuery('/topics')
if (error?.code === ErrorCode.NOT_FOUND) return <NotFound />

// In try-catch
import { DataApiError, ErrorCode } from '@shared/data/api'
try {
  await dataApiService.post('/topics', { body: data })
} catch (error) {
  if (error instanceof DataApiError) {
    if (error.code === ErrorCode.VALIDATION_ERROR) {
      const fieldErrors = error.details?.fieldErrors
    }
    if (error.isRetryable) { /* safe to retry */ }
  }
}
```

## Preference Hooks (User Settings)

Import from `@data/hooks/usePreference`.

### usePreference (Single)

```typescript
// Optimistic (default) - UI updates immediately, syncs to DB
const [theme, setTheme] = usePreference('app.theme.mode')
await setTheme('dark')

// Pessimistic - waits for DB confirmation before UI update
const [apiKey, setApiKey] = usePreference('api.key', { optimistic: false })
await setApiKey('sk-...')
```

**When to use which:**
- **Optimistic** (default): frequent, non-critical changes (theme, font size)
- **Pessimistic**: security-sensitive or external-service settings (API keys)

### usePreferences (Multiple)

```typescript
const { theme, language, fontSize } = usePreferences([
  'app.theme.mode',
  'app.language',
  'chat.message.font_size'
])
```

### Direct Service (non-React)

```typescript
import { preferenceService } from '@data/PreferenceService'

// Read
const theme = await preferenceService.get('app.theme.mode')
const settings = await preferenceService.getMultiple(['app.theme.mode', 'app.language'])

// Write
await preferenceService.set('app.theme.mode', 'dark')
await preferenceService.setMultiple({ 'app.theme.mode': 'dark', 'app.language': 'en' })

// Subscribe (useful in services, not components)
const unsub = preferenceService.subscribe('app.theme.mode', (newValue) => {
  // Called when preference changes in any window
})
unsub() // cleanup
```

## Cache Hooks (Temporary/Regenerable Data)

Import from `@data/hooks/useCache`.

### Three Tiers

| Tier | Hook | Scope | Survives Restart | Cross-Window Sync | Use When |
|------|------|-------|-----------------|-------------------|----------|
| **Memory** | `useCache` | Single renderer process | No | No | Computed results, search results, scroll positions — data local to one window that can be recomputed |
| **Shared** | `useSharedCache` | All renderer windows | No | Yes (via Main) | UI state that must stay in sync across windows (sidebar collapsed, active panel, selection state) |
| **Persist** | `usePersistCache` | All renderer windows | Yes (localStorage) | Yes (via Main) | User-specific ephemeral data worth keeping across restarts but not critical enough for Preference (recent files, last-used filters, draft text) |

**Decision flow:**
1. Does this state need to survive app restart? → `usePersistCache`
2. Does this state need to sync across windows? → `useSharedCache`
3. Otherwise → `useCache` (memory-only, cheapest)

```typescript
// Memory cache - lost on restart, single-window only
const [results, setResults] = useCache('search.results', [])
const [results, setResults] = useCache('search.results', [], { ttl: 30000 }) // with TTL

// Shared cache - cross-window sync via Main, lost on restart
const [collapsed, setCollapsed] = useSharedCache('ui.sidebar.collapsed', false)

// Persist cache - cross-window sync + survives restart via localStorage
const [recent, setRecent] = usePersistCache('app.recent_files', [])
```

### Type-Safe vs Casual vs Template Keys

```typescript
// Type-safe (schema key) - auto-completion, compile-time validation
const [counter, setCounter] = useCache('ui.counter', 0)

// Template key (dynamic pattern, auto type inference)
const [scrollPos, setScrollPos] = useCache('scroll.position.topic123') // inferred: number

// Casual (fully dynamic, manual type)
cacheService.setCasual<TopicCache>(`topic:${id}`, data)
const topic = cacheService.getCasual<TopicCache>(`topic:${id}`)
```

### Direct Service (non-React)

```typescript
import { cacheService } from '@data/CacheService'

// Memory
cacheService.set('search.results', data)
cacheService.set('search.results', data, 30000) // with TTL
const data = cacheService.get('search.results')
cacheService.delete('search.results')

// Shared
cacheService.setShared('window.layout', config)
const layout = cacheService.getShared('window.layout')

// Persist
cacheService.setPersist('app.recent_files', files)
const files = cacheService.getPersist('app.recent_files')
```

### Shared Cache Ready State

```typescript
// SharedCache syncs from Main on window init (async)
if (cacheService.isSharedCacheReady()) { /* synced */ }

const unsub = cacheService.onSharedCacheReady(() => {
  // Called immediately if already ready, or when sync completes
})

// getShared() returns undefined before ready
// setShared() works immediately (broadcasts to Main)
// Hooks work normally - update when sync completes
```

## Testing (Strict TDD)

Follow the red-green-refactor cycle for every component migration. For each piece of UI:
1. **Red**: Write a failing test for the new hook/component behavior
2. **Green**: Write the minimum code to make it pass (replace Redux with v2 hook)
3. **Refactor**: Clean up while keeping tests green

Use the unified mocks in `tests/__mocks__/renderer/`.

### Test Setup

Mocks are globally configured in `tests/renderer.setup.ts`. Import mock utilities via `@test-mocks/*`:

```typescript
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
```

### Testing DataApi Components

```typescript
import { describe, expect, it, beforeEach } from 'vitest'
import { useQuery, useMutation } from '@data/hooks/useDataApi'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'

describe('TopicList', () => {
  beforeEach(() => MockUseDataApiUtils.resetMocks())

  it('should fetch topics via useQuery', () => {
    MockUseDataApiUtils.mockQueryData('/topics', { items: [{ id: '1', name: 'Test' }] })
    const { data } = useQuery('/topics')
    expect(data.items).toHaveLength(1)
  })

  it('should handle loading state', () => {
    const { loading } = useQuery('/topics')
    expect(loading).toBe(false) // mock returns immediately
  })

  it('should create topic via useMutation', async () => {
    const { mutate } = useMutation('POST', '/topics')
    const result = await mutate({ body: { name: 'New' } })
    expect(result.created).toBe(true)
  })

  it('should handle API errors', async () => {
    MockDataApiUtils.setErrorResponse('/topics', 'GET', new Error('Network error'))
    // Test error handling in component
  })
})
```

### Testing Preference Components

```typescript
import { usePreference } from '@data/hooks/usePreference'

it('should read and update preference', async () => {
  const [theme, setTheme] = usePreference('app.theme.mode')
  expect(theme).toBeDefined()
  await setTheme('dark')
})
```

### Testing Cache Components

```typescript
import { useCache } from '@data/hooks/useCache'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'

beforeEach(() => MockCacheUtils.resetMocks())

it('should use cache with initial value', () => {
  const [value, setValue] = useCache('search.results', [])
  expect(value).toEqual([])
})

it('should pre-populate cache for testing', () => {
  MockCacheUtils.setInitialState({
    memory: [['search.results', [{ id: '1' }]]],
  })
  const [value] = useCache('search.results', [])
  expect(value).toHaveLength(1)
})
```

### What to Test

- Component renders correctly with data from hooks
- Loading and error states display properly
- User interactions trigger correct mutations/updates
- Multi-window behavior: shared cache syncs, local cache doesn't
- Old Redux imports are removed (no `useAppSelector`/`dispatch`)

## Common Migration Patterns

### Settings Page
```typescript
// Before: Redux
const theme = useAppSelector(s => s.settings.theme)
dispatch(updateSettings({ theme: 'dark' }))

// After: Preference
const [theme, setTheme] = usePreference('app.theme.mode')
await setTheme('dark')
```

### Data List with CRUD
```typescript
// Before: Redux + Dexie
const topics = useAppSelector(s => s.topics.items)
dispatch(addTopic(data))

// After: DataApi
const { data: topics, isLoading } = useQuery('/topics')
const { trigger: addTopic } = useMutation('POST', '/topics', { refresh: ['/topics'] })
await addTopic({ body: data })
```

### UI State (Sidebar, Panels)
```typescript
// Before: Redux
const collapsed = useAppSelector(s => s.runtime.sidebarCollapsed)
dispatch(setSidebarCollapsed(true))

// After: SharedCache (cross-window) or local state
const [collapsed, setCollapsed] = useSharedCache('ui.sidebar.collapsed', false)
```

### Computed/Derived Data
```typescript
// Before: Redux selector
const stats = useAppSelector(selectTopicStats)

// After: useQuery (computed on server) or useCache (computed on client)
const { data: stats } = useQuery('/topics/stats')
// or
const [stats, setStats] = useCache('topics.stats', null)
```

### Feature Toggles
```typescript
// Before: Redux
const showTimestamp = useAppSelector(s => s.settings.showMessageTimestamp)

// After: Preference
const [showTimestamp] = usePreference('chat.display.show_timestamp')
```

## Adding New Schema Keys

### New Cache Key
1. Add to `packages/shared/data/cache/cacheSchemas.ts`:
   ```typescript
   export type UseCacheSchema = {
     'myFeature.data': MyDataType
   }
   export const DefaultUseCache = {
     'myFeature.data': { items: [], lastUpdated: 0 }
   }
   ```
2. Template key for dynamic patterns:
   ```typescript
   'scroll.position.${topicId}': number  // matches scroll.position.topic123
   ```

### New Preference Key
See `v2-data-api` skill, "Adding a Preference Key" section.

## Checklist

### TDD Cycle (red-green-refactor)
- [ ] Component/hook tests written and **failing** (red) with mocked services (`@test-mocks/renderer/*`)
- [ ] Minimum hook/component code written to make tests pass (green)
- [ ] Loading and error state tests added (red), then handled (green)
- [ ] User interaction tests added (red): mutations, preference updates
- [ ] Code refactored with all tests still passing
- [ ] Mock utilities reset in `beforeEach`
- [ ] Tests pass: `pnpm test:renderer`

### Implementation details
- [ ] Identified correct system for each piece of data (DataApi vs Preference vs Cache)
- [ ] Old `useAppSelector` / `dispatch` calls removed
- [ ] New hooks wired up with proper types
- [ ] Loading states handled (`isLoading` for DataApi)
- [ ] Error states handled (DataApi error codes)
- [ ] Mutation callbacks set up (`refresh`, `onSuccess`)
- [ ] Multi-window behavior verified (shared data syncs, local data doesn't)
- [ ] Optimistic vs pessimistic update strategy chosen for preferences
- [ ] Cache tier chosen correctly (memory vs shared vs persist)
- [ ] New cache/preference keys added to schemas

### Quality
- [ ] All tests pass: `pnpm test`
- [ ] `pnpm lint && pnpm format` pass
- [ ] `pnpm build:check` passes

## Documentation References

- `docs/en/references/data/README.md` - System selection guide
- `docs/en/references/data/data-api-in-renderer.md` - DataApi hooks and patterns
- `docs/en/references/data/preference-usage.md` - Preference hooks and service
- `docs/en/references/data/cache-overview.md` - Cache architecture
- `docs/en/references/data/cache-usage.md` - Cache hooks and patterns
