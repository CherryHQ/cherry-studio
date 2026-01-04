# Test Mocks

Unified test mocks for the project, organized by process type and globally configured in test setup files.

## Overview

### Available Mocks

| Process | Mock | Description |
|---------|------|-------------|
| Renderer | `CacheService` | Three-tier cache (memory/shared/persist) |
| Renderer | `DataApiService` | HTTP client for Data API |
| Renderer | `PreferenceService` | User preferences |
| Renderer | `useDataApi` | Data API hooks (useQuery, useMutation, etc.) |
| Renderer | `usePreference` | Preference hooks |
| Renderer | `useCache` | Cache hooks |
| Main | `CacheService` | Internal + shared cache |
| Main | `DataApiService` | API coordinator |
| Main | `PreferenceService` | Preference service |

### File Structure

```
tests/__mocks__/
├── renderer/
│   ├── CacheService.ts
│   ├── DataApiService.ts
│   ├── PreferenceService.ts
│   ├── useDataApi.ts
│   ├── usePreference.ts
│   └── useCache.ts
├── main/
│   ├── CacheService.ts
│   ├── DataApiService.ts
│   └── PreferenceService.ts
├── RendererLoggerService.ts
└── MainLoggerService.ts
```

### Test Setup

Mocks are globally configured in setup files:
- **Renderer**: `tests/renderer.setup.ts`
- **Main**: `tests/main.setup.ts`

---

## Renderer Mocks

### CacheService

Three-tier cache system with type-safe and casual (dynamic key) methods.

#### Methods

| Category | Method | Signature |
|----------|--------|-----------|
| Memory (typed) | `get` | `<K>(key: K) => UseCacheSchema[K]` |
| Memory (typed) | `set` | `<K>(key: K, value, ttl?) => void` |
| Memory (typed) | `has` | `<K>(key: K) => boolean` |
| Memory (typed) | `delete` | `<K>(key: K) => boolean` |
| Memory (typed) | `hasTTL` | `<K>(key: K) => boolean` |
| Memory (casual) | `getCasual` | `<T>(key: string) => T \| undefined` |
| Memory (casual) | `setCasual` | `<T>(key, value, ttl?) => void` |
| Memory (casual) | `hasCasual` | `(key: string) => boolean` |
| Memory (casual) | `deleteCasual` | `(key: string) => boolean` |
| Memory (casual) | `hasTTLCasual` | `(key: string) => boolean` |
| Shared (typed) | `getShared` | `<K>(key: K) => SharedCacheSchema[K]` |
| Shared (typed) | `setShared` | `<K>(key: K, value, ttl?) => void` |
| Shared (typed) | `hasShared` | `<K>(key: K) => boolean` |
| Shared (typed) | `deleteShared` | `<K>(key: K) => boolean` |
| Shared (typed) | `hasSharedTTL` | `<K>(key: K) => boolean` |
| Shared (casual) | `getSharedCasual` | `<T>(key: string) => T \| undefined` |
| Shared (casual) | `setSharedCasual` | `<T>(key, value, ttl?) => void` |
| Shared (casual) | `hasSharedCasual` | `(key: string) => boolean` |
| Shared (casual) | `deleteSharedCasual` | `(key: string) => boolean` |
| Shared (casual) | `hasSharedTTLCasual` | `(key: string) => boolean` |
| Persist | `getPersist` | `<K>(key: K) => RendererPersistCacheSchema[K]` |
| Persist | `setPersist` | `<K>(key: K, value) => void` |
| Persist | `hasPersist` | `(key) => boolean` |
| Hook mgmt | `registerHook` | `(key: string) => void` |
| Hook mgmt | `unregisterHook` | `(key: string) => void` |
| Ready state | `isSharedCacheReady` | `() => boolean` |
| Ready state | `onSharedCacheReady` | `(callback) => () => void` |
| Lifecycle | `subscribe` | `(key, callback) => () => void` |
| Lifecycle | `cleanup` | `() => void` |

#### Usage

```typescript
import { cacheService } from '@data/CacheService'
import { MockCacheUtils } from 'tests/__mocks__/renderer/CacheService'

describe('Cache', () => {
  beforeEach(() => MockCacheUtils.resetMocks())

  it('basic usage', () => {
    cacheService.setCasual('key', { data: 'value' }, 5000)
    expect(cacheService.getCasual('key')).toEqual({ data: 'value' })
  })

  it('with test utilities', () => {
    MockCacheUtils.setInitialState({
      memory: [['key', 'value']],
      shared: [['shared.key', 'shared']],
      persist: [['persist.key', 'persist']]
    })
  })
})
```

---

### DataApiService

HTTP client with subscriptions and retry configuration.

#### Methods

| Method | Signature |
|--------|-----------|
| `get` | `(path, options?) => Promise<any>` |
| `post` | `(path, options) => Promise<any>` |
| `put` | `(path, options) => Promise<any>` |
| `patch` | `(path, options) => Promise<any>` |
| `delete` | `(path, options?) => Promise<any>` |
| `subscribe` | `(options, callback) => () => void` |
| `configureRetry` | `(options) => void` |
| `getRetryConfig` | `() => RetryOptions` |
| `getRequestStats` | `() => { pendingRequests, activeSubscriptions }` |

#### Usage

```typescript
import { dataApiService } from '@data/DataApiService'
import { MockDataApiUtils } from 'tests/__mocks__/renderer/DataApiService'

describe('API', () => {
  beforeEach(() => MockDataApiUtils.resetMocks())

  it('basic request', async () => {
    const response = await dataApiService.get('/topics')
    expect(response.topics).toBeDefined()
  })

  it('custom response', async () => {
    MockDataApiUtils.setCustomResponse('/topics', 'GET', { custom: true })
    const response = await dataApiService.get('/topics')
    expect(response.custom).toBe(true)
  })

  it('error simulation', async () => {
    MockDataApiUtils.setErrorResponse('/topics', 'GET', new Error('Failed'))
    await expect(dataApiService.get('/topics')).rejects.toThrow('Failed')
  })
})
```

---

### useDataApi Hooks

React hooks for data operations.

#### Hooks

| Hook | Signature | Returns |
|------|-----------|---------|
| `useQuery` | `(path, options?)` | `{ data, loading, error, refetch, mutate }` |
| `useMutation` | `(method, path, options?)` | `{ mutate, loading, error }` |
| `usePaginatedQuery` | `(path, options?)` | `{ items, total, page, loading, error, hasMore, hasPrev, prevPage, nextPage, refresh, reset }` |
| `useInvalidateCache` | `()` | `(keys?) => Promise<any>` |

#### Usage

```typescript
import { useQuery, useMutation } from '@data/hooks/useDataApi'
import { MockUseDataApiUtils } from 'tests/__mocks__/renderer/useDataApi'

describe('Hooks', () => {
  beforeEach(() => MockUseDataApiUtils.resetMocks())

  it('useQuery', () => {
    const { data, loading } = useQuery('/topics')
    expect(loading).toBe(false)
    expect(data).toBeDefined()
  })

  it('useMutation', async () => {
    const { mutate } = useMutation('POST', '/topics')
    const result = await mutate({ body: { name: 'New' } })
    expect(result.created).toBe(true)
  })

  it('custom data', () => {
    MockUseDataApiUtils.mockQueryData('/topics', { custom: true })
    const { data } = useQuery('/topics')
    expect(data.custom).toBe(true)
  })
})
```

---

### useCache Hooks

React hooks for cache operations.

| Hook | Signature | Returns |
|------|-----------|---------|
| `useCache` | `(key, initValue?)` | `[value, setValue]` |
| `useSharedCache` | `(key, initValue?)` | `[value, setValue]` |
| `usePersistCache` | `(key)` | `[value, setValue]` |

```typescript
import { useCache } from '@data/hooks/useCache'

const [value, setValue] = useCache('key', 'default')
setValue('new value')
```

---

### usePreference Hooks

React hooks for preferences.

| Hook | Signature | Returns |
|------|-----------|---------|
| `usePreference` | `(key)` | `[value, setValue]` |
| `useMultiplePreferences` | `(keyMap)` | `[values, setValues]` |

```typescript
import { usePreference } from '@data/hooks/usePreference'

const [theme, setTheme] = usePreference('ui.theme')
await setTheme('dark')
```

---

## Main Process Mocks

### Main CacheService

Internal cache and cross-window shared cache.

#### Methods

| Category | Method | Signature |
|----------|--------|-----------|
| Lifecycle | `initialize` | `() => Promise<void>` |
| Lifecycle | `cleanup` | `() => void` |
| Internal | `get` | `<T>(key: string) => T \| undefined` |
| Internal | `set` | `<T>(key, value, ttl?) => void` |
| Internal | `has` | `(key: string) => boolean` |
| Internal | `delete` | `(key: string) => boolean` |
| Shared | `getShared` | `<K>(key: K) => SharedCacheSchema[K] \| undefined` |
| Shared | `setShared` | `<K>(key: K, value, ttl?) => void` |
| Shared | `hasShared` | `<K>(key: K) => boolean` |
| Shared | `deleteShared` | `<K>(key: K) => boolean` |

```typescript
import { MockMainCacheServiceUtils } from 'tests/__mocks__/main/CacheService'

beforeEach(() => MockMainCacheServiceUtils.resetMocks())

MockMainCacheServiceUtils.setCacheValue('key', 'value')
MockMainCacheServiceUtils.setSharedCacheValue('shared.key', 'shared')
```

---

### Main DataApiService

API coordinator managing ApiServer and IpcAdapter.

| Method | Signature |
|--------|-----------|
| `initialize` | `() => Promise<void>` |
| `shutdown` | `() => Promise<void>` |
| `getSystemStatus` | `() => object` |
| `getApiServer` | `() => ApiServer` |

```typescript
import { MockMainDataApiServiceUtils } from 'tests/__mocks__/main/DataApiService'

beforeEach(() => MockMainDataApiServiceUtils.resetMocks())

MockMainDataApiServiceUtils.simulateInitializationError(new Error('Failed'))
```

---

## Utility Functions

Each mock exports a `MockXxxUtils` object with testing utilities:

| Utility | Description |
|---------|-------------|
| `resetMocks()` | Reset all mock state and call counts |
| `setXxxValue()` | Set specific values for testing |
| `getXxxValue()` | Get current mock values |
| `simulateXxx()` | Simulate specific scenarios (errors, expiration, etc.) |
| `getMockCallCounts()` | Get call counts for debugging |

---

## Best Practices

1. **Use global mocks** - Don't re-mock in individual tests unless necessary
2. **Reset in beforeEach** - Call `MockXxxUtils.resetMocks()` to ensure test isolation
3. **Use utility functions** - Prefer `MockXxxUtils` over direct mock manipulation
4. **Type safety** - Mocks match actual service interfaces

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Mock not applied | Check test runs in correct process (renderer/main in vitest.config.ts) |
| Type errors | Ensure mock matches actual interface, use type assertions if needed |
| State pollution | Call `resetMocks()` in `beforeEach` |
| Import issues | Use path aliases (`@data/CacheService`) not relative paths |
