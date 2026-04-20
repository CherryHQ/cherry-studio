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
| Main | `application` | Unified mock application factory with `application.get()` |
| Main | `DbService` | Database service with mock db |
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
│   ├── application.ts
│   ├── CacheService.ts
│   ├── DataApiService.ts
│   ├── DbService.ts
│   └── PreferenceService.ts
├── RendererLoggerService.ts
└── MainLoggerService.ts
```

### Test Setup

Mocks are globally configured in setup files:
- **Renderer**: `tests/renderer.setup.ts`
- **Main**: `tests/main.setup.ts`

### Import Path Alias

Use `@test-mocks/*` to import mock utilities:

```typescript
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
```

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
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'

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
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'

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
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'

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

### Application Mock (Unified Factory)

All main-process tests get `application.get()` mocked globally via `tests/main.setup.ts`. Tests that need custom service instances can override specific services using `mockApplicationFactory(overrides)`.

#### API

| Export | Description |
|--------|-------------|
| `mockApplicationFactory(overrides?)` | Returns full mock module `{ application, serviceList }` for `vi.mock()` |
| `createMockApplication(overrides?)` | Returns just the mock `application` object |
| `defaultServiceInstances` | Default mock instances for all registered services |

#### Usage

**Global setup** (already configured in `tests/main.setup.ts`):

```typescript
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('./__mocks__/main/application')
  return mockApplicationFactory()
})
```

**Override specific services** in individual test files:

```typescript
const mockDb = { select: vi.fn(), insert: vi.fn() }

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    DbService: { getDb: () => mockDb }
  })
})
```

**Override with custom method spies:**

```typescript
const mockPreferenceGet = vi.fn()

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: { get: mockPreferenceGet }
  })
})
```

> **Important**: Do NOT create inline `application.get()` mocks in test files. Always use `mockApplicationFactory()` from `@test-mocks/main/application`.

---

### Main DbService

Database service providing access to the mock SQLite database.

#### Methods

| Method | Signature |
|--------|-----------|
| `getDb` | `() => MockDb` |
| `isReady` | `boolean` (getter) |

```typescript
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'

beforeEach(() => MockMainDbServiceUtils.resetMocks())

// Use default mock db
MockMainDbServiceUtils.getDefaultMockDb()

// Replace with custom db
MockMainDbServiceUtils.setDb(customMockDb)
```

---

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
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'

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
import { MockMainDataApiServiceUtils } from '@test-mocks/main/DataApiService'

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
2. **Use `mockApplicationFactory()`** - When a test needs to override `application.get()`, use `mockApplicationFactory(overrides)` instead of creating inline mocks
3. **Reset in beforeEach** - Call `MockXxxUtils.resetMocks()` to ensure test isolation
4. **Use utility functions** - Prefer `MockXxxUtils` over direct mock manipulation
5. **Type safety** - Mocks match actual service interfaces

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Mock not applied | Check test runs in correct process (renderer/main in vitest.config.ts) |
| Type errors | Ensure mock matches actual interface, use type assertions if needed |
| State pollution | Call `resetMocks()` in `beforeEach` |
| Import issues | Use path aliases (`@data/CacheService`) not relative paths |
