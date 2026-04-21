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
| `useReadCache` | `()` | `(path, query?) => TResponse \| undefined` |
| `useWriteCache` | `()` | `async (path, value, query?) => void` |

#### Usage

```typescript
import { useQuery, useMutation, useReadCache, useWriteCache } from '@data/hooks/useDataApi'
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

  it('useReadCache reads seeded values', () => {
    // Pre-populate the mock cache (key shape mirrors production:
    // omit `query` for [path], pass a non-empty `query` for [path, query]).
    MockUseDataApiUtils.seedCache('/topics', { topics: [{ id: 't1' }], total: 1 })

    const read = useReadCache()
    expect(read('/topics')).toEqual({ topics: [{ id: 't1' }], total: 1 })
  })

  it('useWriteCache persists to mock store (assertable via getCachedValue)', async () => {
    const write = useWriteCache()
    await write('/topics', { topics: [], total: 0 })

    expect(MockUseDataApiUtils.getCachedValue('/topics')).toEqual({ topics: [], total: 0 })
  })
})
```

> **Note:** `useReadCache`/`useWriteCache` share one in-memory `Map` under the hood. `resetMocks()` clears both call history and the cache store; use `clearCache()` if you want to drop cache entries without resetting hook mocks.

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

### Scope

`tests/__mocks__/main/` holds mocks for **cross-cutting infrastructure only**: `PreferenceService`, `CacheService`, `DbService`, `DataApiService`, plus minimal `MainWindowService` / `WindowManager` stubs. All are pre-mocked globally via `tests/main.setup.ts`.

**Do not add files here for feature-specific lifecycle services** (e.g., `MarkdownTaskService`, `KnowledgeRuntimeService`). The `ServiceOverrides` type is deliberately locked to `keyof typeof defaultServiceInstances` to enforce this boundary. Stub them locally — see [Testing Other Lifecycle Services](#testing-other-lifecycle-services).

| Service category | How to mock |
|---|---|
| Infrastructure (listed above) | Already mocked globally; override via `mockApplicationFactory({ Name: {...} })` |
| Feature-specific lifecycle service | Local `vi.mock('@application')` + `MockBaseService` in the test file |
| Direct-import singleton (no lifecycle) | `vi.mock('path/to/module')` directly |

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

**Override infrastructure services** in individual test files:

```typescript
const mockDb = { select: vi.fn(), insert: vi.fn() }

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    DbService: { getDb: () => mockDb }
  })
})
```

For **non-infrastructure** services, don't override here — use [Testing Other Lifecycle Services](#testing-other-lifecycle-services) instead.

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

#### Methods

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

### Main PreferenceService

Preference store with typed keys, seeded from `DefaultPreferences.default`.

#### Methods

| Method | Signature |
|--------|-----------|
| `initialize` | `() => Promise<void>` |
| `get` | `<K>(key: K) => UnifiedPreferenceType[K]` |
| `set` | `<K>(key: K, value) => Promise<void>` |
| `getMultiple` | `<K>(keys: K[]) => Record<K, UnifiedPreferenceType[K]>` |
| `setMultiple` | `(values) => Promise<void>` |
| `subscribeForWindow` | `(windowId, keys) => void` |

```typescript
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

beforeEach(() => MockMainPreferenceServiceUtils.resetMocks())

// Seed a preference value
MockMainPreferenceServiceUtils.setPreferenceValue('ui.theme', 'dark')

// Simulate an external change (fires main-process subscribers)
MockMainPreferenceServiceUtils.simulateExternalPreferenceChange('ui.theme', 'light')
```

Utilities: `setPreferenceValue`, `getPreferenceValue`, `setMultiplePreferenceValues`, `getAllPreferenceValues`, `simulateWindowSubscription`, `simulateExternalPreferenceChange`, `getSubscriptionCounts`.

---

### Testing Other Lifecycle Services

Stub feature-specific lifecycle services **locally in the test file**. A test typically needs three substitutions: `@application`, `BaseService`, and lifecycle decorators.

#### Canonical Setup

```typescript
import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, startTaskMock, getTaskResultMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  startTaskMock: vi.fn(),
  getTaskResultMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: appGetMock }
}))

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()
  class MockBaseService {
    ipcHandle = vi.fn()
    protected readonly _disposables: Array<{ dispose: () => void } | (() => void)> = []
    protected registerDisposable<T extends { dispose: () => void } | (() => void)>(d: T): T {
      this._disposables.push(d)
      return d
    }
  }
  return { ...actual, BaseService: MockBaseService }
})

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'MarkdownTaskService') {
      return { startTask: startTaskMock, getTaskResult: getTaskResultMock }
    }
    throw new Error(`Unexpected application.get(${name})`)
  })
})

// Import SUT after mocks are declared.
const { FileProcessingOrchestrationService } = await import('../FileProcessingOrchestrationService')
```

#### Common Assertions

Drive lifecycle hooks (`onInit` / `onStart` / `onStop` / `onDestroy`) manually — the container isn't running in tests.

| Target | How |
|---|---|
| Phase | `expect(getPhase(MyService)).toBe(Phase.WhenReady)` |
| Dependencies | `expect(getDependencies(MyService)).toEqual(['OtherService'])` |
| Registered IPC channels | `const svc = new MyService(); (svc as any).onInit(); (svc as any).ipcHandle.mock.calls.map(c => c[0])` |
| Single IPC handler | `ipcHandle.mock.calls.find(c => c[0] === 'channel')?.[1]`, then invoke |
| Disposables | Drive lifecycle, inspect `(svc as any)._disposables` |

#### Reference Implementations

- `src/main/services/knowledge/__tests__/KnowledgeOrchestrationService.test.ts` — dispatch stub + phase/deps + per-channel handler inspection
- `src/main/services/__tests__/ShortcutService.test.ts` — richer `MockBaseService` with `registerDisposable` + no-op decorator replacements

---

## Best Practices

1. Infrastructure services come pre-mocked; override via `mockApplicationFactory({ Name: {...} })`, not ad-hoc `application.get` mocks.
2. Feature-specific lifecycle services are stubbed locally — don't add them to `tests/__mocks__/main/` or `defaultServiceInstances`.
3. Each infrastructure mock exposes `MockMain<Name>ServiceUtils` with `resetMocks()` plus service-specific helpers (seeding values, simulating errors). Call `resetMocks()` in `beforeEach`.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Mock not applied | Check test runs in correct process (renderer/main in vitest.config.ts) |
| Type errors | Ensure mock matches actual interface, use type assertions if needed |
| State pollution | Call `resetMocks()` in `beforeEach` |
| Import issues | Use path aliases (`@data/CacheService`) not relative paths |
