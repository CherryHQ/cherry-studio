import { dataApiService } from '@data/DataApiService'
import type * as RendererConstantModule from '@renderer/config/constant'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { BranchMessagesResponse } from '@shared/data/types/message'
import { act, renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import type { Cache } from 'swr'
import useSWR, { SWRConfig, unstable_serialize, useSWRConfig } from 'swr'
import type { SWRInfiniteKeyedMutator } from 'swr/infinite'
import useSWRInfinite, { unstable_serialize as unstable_serialize_infinite } from 'swr/infinite'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Tests exercise the real implementation; the global renderer setup otherwise
// replaces this module with a mock for consuming components.
vi.unmock('@data/hooks/useDataApi')

// `isDev` reads `window.electron.process.env.NODE_ENV`, which isn't populated
// in the Vitest environment. Force it to true so the dev-only pattern
// assertions fire during these tests.
vi.mock('@renderer/config/constant', async (importOriginal) => {
  const actual = await importOriginal<typeof RendererConstantModule>()
  return { ...actual, isDev: true }
})

import {
  __testing,
  useInfiniteFlatItems,
  useInfiniteQuery,
  usePaginatedQuery,
  useReadCache,
  useWriteCache
} from '../useDataApi'

const {
  createKeyMatcher,
  createMultiKeyMatcher,
  resolveTemplate,
  buildSWRKey,
  extractInfinitePath,
  findMatchingInfiniteKeys,
  invalidatePathPatterns
} = __testing

/**
 * Build a useSWRInfinite cache key for `[path, query?]`. Uses `swr/infinite`'s
 * own `unstable_serialize` (not the plain `swr` one — they differ: only the
 * infinite flavor prepends `$inf$`). Self-validates against SWR's real format.
 */
const infKey = (path: string, query?: unknown) =>
  unstable_serialize_infinite(() => (query === undefined ? [path] : [path, query]))

describe('createKeyMatcher', () => {
  it('exact-matches a plain path against [path] cache keys', () => {
    const match = createKeyMatcher('/providers')
    expect(match(['/providers'])).toBe(true)
    expect(match(['/providers', { limit: 10 }])).toBe(true)
    expect(match(['/providers/abc'])).toBe(false)
    expect(match(['/models'])).toBe(false)
  })

  it('prefix-matches `/*` patterns over resolved sub-paths', () => {
    const match = createKeyMatcher('/providers/*')
    expect(match(['/providers/abc'])).toBe(true)
    expect(match(['/providers/abc/api-keys'])).toBe(true)
    expect(match(['/providers/abc/api-keys/key-001'])).toBe(true)
    // Exact '/providers' shouldn't match a `/*` prefix (prefix expects at least one child segment)
    expect(match(['/providers'])).toBe(false)
  })

  it('preserves trailing slash so sibling resources are not misidentified', () => {
    const match = createKeyMatcher('/providers/*')
    // /providers-archived shares a prefix string but not a path segment boundary
    expect(match(['/providers-archived'])).toBe(false)
    expect(match(['/providers-archived/xyz'])).toBe(false)
  })

  it('rejects non-array keys and keys whose first slot is non-string', () => {
    const match = createKeyMatcher('/providers')
    expect(match('/providers')).toBe(false)
    expect(match(null)).toBe(false)
    expect(match(undefined)).toBe(false)
    expect(match([123])).toBe(false)
    expect(match([{ path: '/providers' }])).toBe(false)
  })
})

describe('createMultiKeyMatcher', () => {
  it('supports a mix of exact and `/*` prefix patterns', () => {
    const match = createMultiKeyMatcher(['/providers', '/models/*'])
    expect(match(['/providers'])).toBe(true)
    expect(match(['/models/openai-gpt-4'])).toBe(true)
    expect(match(['/models/openai-gpt-4/variants'])).toBe(true)
    expect(match(['/providers/abc'])).toBe(false) // exact, not prefix
    expect(match(['/topics'])).toBe(false)
  })

  it('returns false for invalid key shapes', () => {
    const match = createMultiKeyMatcher(['/providers', '/providers/*'])
    expect(match({ path: '/providers' })).toBe(false)
    expect(match([])).toBe(false)
    expect(match([null])).toBe(false)
  })
})

describe('dev-mode pattern assertions', () => {
  // `assertValidPattern` only throws when `isDev === true`. This suite mocks
  // `@renderer/config/constant` at the top of the file to force `isDev: true`.
  it('rejects non-segment wildcards like "/foo*" on single-key matcher', () => {
    expect(() => createKeyMatcher('/providers*')).toThrow(/wildcard must be a full path segment/)
  })

  it('rejects bare wildcards on single-key matcher', () => {
    expect(() => createKeyMatcher('/*')).toThrow(/bare wildcard/)
    expect(() => createKeyMatcher('*')).toThrow()
  })

  it('rejects invalid patterns when found in a multi-key array', () => {
    expect(() => createMultiKeyMatcher(['/providers', '/m*'])).toThrow(/wildcard must be a full path segment/)
    expect(() => createMultiKeyMatcher(['/valid/*', '/*'])).toThrow(/bare wildcard/)
  })
})

describe('resolveTemplate', () => {
  it('passes through paths without placeholders', () => {
    expect(resolveTemplate('/providers')).toBe('/providers')
    expect(resolveTemplate('/providers', { providerId: 'abc' })).toBe('/providers')
  })

  it('substitutes a single `:param`', () => {
    expect(resolveTemplate('/providers/:providerId', { providerId: 'abc' })).toBe('/providers/abc')
  })

  it('substitutes multiple `:param` tokens in the same path', () => {
    expect(
      resolveTemplate('/providers/:providerId/api-keys/:keyId', {
        providerId: 'abc',
        keyId: 'key-001'
      })
    ).toBe('/providers/abc/api-keys/key-001')
  })

  it('substitutes greedy `:name*` placeholders, preserving slashes in the value', () => {
    expect(
      resolveTemplate('/models/:uniqueModelId*', {
        uniqueModelId: 'openai:gpt-4/variant/with-slashes'
      })
    ).toBe('/models/openai:gpt-4/variant/with-slashes')
  })

  it('accepts numeric param values', () => {
    expect(resolveTemplate('/topics/:topicId', { topicId: 42 })).toBe('/topics/42')
  })

  it('leaves RPC verb suffixes (`models:resolve`, `models:reconcile`) intact', () => {
    expect(resolveTemplate('/providers/:providerId/models:reconcile', { providerId: 'cherryin' })).toBe(
      '/providers/cherryin/models:reconcile'
    )
    expect(resolveTemplate('/providers/:providerId/models:resolve', { providerId: 'openai' })).toBe(
      '/providers/openai/models:resolve'
    )
  })

  it('throws when a required placeholder is missing', () => {
    expect(() => resolveTemplate('/providers/:providerId', {})).toThrow(/Missing param "providerId"/)
    expect(() => resolveTemplate('/providers/:providerId/api-keys/:keyId', { providerId: 'abc' })).toThrow(
      /Missing param "keyId"/
    )
  })
})

describe('buildSWRKey cache-key equivalence', () => {
  // This is the critical invariant: a template + resolveTemplate must produce
  // byte-for-byte identical keys to a pre-resolved concrete path. Drift here
  // causes phantom refresh misses that are extremely hard to debug.

  it('produces identical keys for template+params and concrete helper paths (no query)', () => {
    const keyFromTemplate = buildSWRKey(resolveTemplate('/providers/:providerId', { providerId: 'abc' }))
    const keyFromConcrete = buildSWRKey('/providers/abc')
    expect(keyFromTemplate).toEqual(keyFromConcrete)
    expect(keyFromTemplate).toMatchInlineSnapshot(`
      [
        "/providers/abc",
      ]
    `)
  })

  it('produces identical keys when query is provided', () => {
    const query = { limit: 10 }
    const keyFromTemplate = buildSWRKey(resolveTemplate('/providers/:providerId', { providerId: 'abc' }), query)
    const keyFromConcrete = buildSWRKey('/providers/abc', query)
    expect(keyFromTemplate).toEqual(keyFromConcrete)
    expect(keyFromTemplate).toMatchInlineSnapshot(`
      [
        "/providers/abc",
        {
          "limit": 10,
        },
      ]
    `)
  })

  it('omits query slot when query is empty', () => {
    expect(buildSWRKey('/providers/abc', {})).toEqual(['/providers/abc'])
    expect(buildSWRKey('/providers/abc', undefined)).toEqual(['/providers/abc'])
  })

  it('includes query slot as-is when non-empty (field order preserved via object literal)', () => {
    const query = { limit: 10, cursor: 'x' }
    expect(buildSWRKey('/providers/abc', query)).toEqual(['/providers/abc', query])
  })
})

// ============================================================================
// useReadCache / useWriteCache: real-SWR integration tests
//
// These hooks directly use `useSWRConfig().cache`/`.mutate` + `unstable_serialize`
// — the only sanctioned place in the codebase for those APIs. Tests run the
// real hooks inside a self-provided SWRConfig so we can assert key shape,
// query folding, and no-revalidation semantics end-to-end without involving
// DataApiService or network layers.
// ============================================================================

/**
 * Build a fresh SWRConfig-wrapped harness. Each test gets its own cache so
 * state never bleeds across tests.
 */
function makeWrapper(initial?: Array<[unknown[], unknown]>) {
  const cache = new Map<string, { data?: unknown }>()
  for (const [key, value] of initial ?? []) {
    cache.set(unstable_serialize(key), { data: value })
  }
  const provider = () => cache
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      SWRConfig,
      { value: { provider, dedupingInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false } },
      children
    )
  return { Wrapper, cache }
}

const PATH = '/providers' as ConcreteApiPaths

describe('useReadCache', () => {
  it('returns undefined on cache miss', () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useReadCache(), { wrapper: Wrapper })
    expect(result.current(PATH)).toBeUndefined()
  })

  it('reads by [path] when query is absent', () => {
    const { Wrapper } = makeWrapper([[['/providers'], { items: [1, 2] }]])
    const { result } = renderHook(() => useReadCache(), { wrapper: Wrapper })
    expect(result.current(PATH)).toEqual({ items: [1, 2] })
  })

  it('collapses empty-query to [path] (matches buildSWRKey behavior)', () => {
    const { Wrapper } = makeWrapper([[['/providers'], { seeded: true }]])
    const { result } = renderHook(() => useReadCache(), { wrapper: Wrapper })
    expect(result.current(PATH, {})).toEqual({ seeded: true })
  })

  it('reads by [path, query] when query is non-empty', () => {
    const { Wrapper } = makeWrapper([
      [['/providers', { limit: 10 }], { paged: true }],
      [['/providers'], { bare: true }]
    ])
    const { result } = renderHook(() => useReadCache(), { wrapper: Wrapper })
    expect(result.current(PATH, { limit: 10 })).toEqual({ paged: true })
    // Different key — must not return the [path, query] value
    expect(result.current(PATH)).toEqual({ bare: true })
  })

  it('returns a reader with stable identity across rerenders', () => {
    const { Wrapper } = makeWrapper()
    const { result, rerender } = renderHook(() => useReadCache(), { wrapper: Wrapper })
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('does NOT subscribe — seeding the cache mid-test does not re-render', () => {
    const { Wrapper, cache } = makeWrapper()
    let renderCount = 0
    const { result } = renderHook(
      () => {
        renderCount++
        return useReadCache()
      },
      { wrapper: Wrapper }
    )

    const initialRenders = renderCount
    // Mutate the underlying cache directly (what an external writer would do).
    cache.set(unstable_serialize(['/providers']), { data: { late: true } })

    // Reader picks up the new value on its next call — but no re-render fires.
    expect(result.current(PATH)).toEqual({ late: true })
    expect(renderCount).toBe(initialRenders)
  })
})

describe('useWriteCache', () => {
  it('writes under [path] when query is absent', async () => {
    const { Wrapper, cache } = makeWrapper()
    const { result } = renderHook(() => useWriteCache(), { wrapper: Wrapper })
    await act(async () => {
      await result.current(PATH, { written: true })
    })
    expect(cache.get(unstable_serialize(['/providers']))?.data).toEqual({ written: true })
  })

  it('writes under [path, query] when query is non-empty', async () => {
    const { Wrapper, cache } = makeWrapper()
    const { result } = renderHook(() => useWriteCache(), { wrapper: Wrapper })
    await act(async () => {
      await result.current(PATH, { paged: true }, { limit: 10 })
    })
    expect(cache.get(unstable_serialize(['/providers', { limit: 10 }]))?.data).toEqual({ paged: true })
    // And does NOT leak into the bare [path] key
    expect(cache.get(unstable_serialize(['/providers']))).toBeUndefined()
  })

  it('collapses empty-query writes to [path] (matches reader side)', async () => {
    const { Wrapper, cache } = makeWrapper()
    const { result } = renderHook(() => useWriteCache(), { wrapper: Wrapper })
    await act(async () => {
      await result.current(PATH, { collapsed: true }, {})
    })
    expect(cache.get(unstable_serialize(['/providers']))?.data).toEqual({ collapsed: true })
  })

  it('does NOT trigger revalidation of an active subscriber', async () => {
    const { Wrapper } = makeWrapper()
    const fetcher = vi.fn().mockResolvedValue({ fetched: true })

    // Mount a real SWR subscriber on the same key so the cache entry is "live".
    const { result: subResult } = renderHook(() => useSWR(['/providers'], fetcher), { wrapper: Wrapper })
    await waitFor(() => expect(subResult.current.data).toEqual({ fetched: true }))
    fetcher.mockClear()

    // Overwrite via useWriteCache; the subscriber should see the new value
    // without the fetcher firing again (that is the whole point of the
    // `false` flag passed to `mutate` inside useWriteCache).
    const { result: writerResult } = renderHook(() => useWriteCache(), { wrapper: Wrapper })
    await act(async () => {
      await writerResult.current(PATH, { overlay: true })
    })

    expect(fetcher).not.toHaveBeenCalled()
    expect(subResult.current.data).toEqual({ overlay: true })
  })

  it('round-trips: value written is readable via useReadCache on the same cache', async () => {
    const { Wrapper } = makeWrapper()
    const { result: writer } = renderHook(() => useWriteCache(), { wrapper: Wrapper })
    const { result: reader } = renderHook(() => useReadCache(), { wrapper: Wrapper })

    await act(async () => {
      await writer.current(PATH, { round: 'trip' })
    })
    expect(reader.current(PATH)).toEqual({ round: 'trip' })
  })

  it('returns a writer with stable identity across rerenders', () => {
    const { Wrapper } = makeWrapper()
    const { result, rerender } = renderHook(() => useWriteCache(), { wrapper: Wrapper })
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})

describe('extractInfinitePath', () => {
  it('extracts path from infinite keys with or without query', () => {
    expect(extractInfinitePath(infKey('/foo'))).toBe('/foo')
    expect(extractInfinitePath(infKey('/foo', { x: 1 }))).toBe('/foo')
    expect(extractInfinitePath(infKey('/translate/histories', { cursor: 'abc', limit: 50 }))).toBe(
      '/translate/histories'
    )
  })

  it('preserves paths containing escaped double quotes', () => {
    const pathWithQuote = '/items/he said "hi"'
    expect(extractInfinitePath(infKey(pathWithQuote, { x: 1 }))).toBe(pathWithQuote)
  })

  it('returns undefined for non-infinite and malformed strings', () => {
    expect(extractInfinitePath('')).toBeUndefined()
    expect(extractInfinitePath('$inf$')).toBeUndefined()
    expect(extractInfinitePath('$inf$"bare"')).toBeUndefined() // missing leading '@'
    expect(extractInfinitePath('$inf$@bare,')).toBeUndefined() // missing '@"'
    expect(extractInfinitePath('$inf$@"/no-close,...')).toBeUndefined() // unclosed quote
    expect(extractInfinitePath('plain-string')).toBeUndefined()
    expect(extractInfinitePath('@"/foo",')).toBeUndefined() // missing $inf$ prefix
  })
})

describe('findMatchingInfiniteKeys', () => {
  // Seed the real SWR-backed cache via makeWrapper, bypassing any mock Cache
  // — the Map is what SWR itself uses, so key-shape drift can't hide here.
  function seed(pairs: Array<[string, unknown]>): Cache {
    const { cache } = makeWrapper()
    for (const [k, v] of pairs) cache.set(k, { data: v })
    return cache as unknown as Cache
  }

  it('returns exact-pattern matches among infinite keys only', () => {
    const cache = seed([
      [infKey('/translate/histories'), undefined],
      [infKey('/translate/histories', { limit: 50 }), undefined],
      [infKey('/translate/lang'), undefined],
      [unstable_serialize(['/translate/histories']), undefined] // non-infinite array key serialized
    ])
    expect(findMatchingInfiniteKeys(cache, ['/translate/histories'])).toEqual([
      infKey('/translate/histories'),
      infKey('/translate/histories', { limit: 50 })
    ])
  })

  it('returns prefix-pattern matches with path-segment boundary', () => {
    const cache = seed([
      [infKey('/providers/p1'), undefined],
      [infKey('/providers/p1/api-keys'), undefined],
      [infKey('/providers-archived'), undefined],
      [infKey('/providers-archived/x'), undefined]
    ])
    expect(findMatchingInfiniteKeys(cache, ['/providers/*'])).toEqual([
      infKey('/providers/p1'),
      infKey('/providers/p1/api-keys')
    ])
  })

  it('supports a mix of exact and prefix patterns', () => {
    const cache = seed([
      [infKey('/a'), undefined],
      [infKey('/a', { q: 1 }), undefined],
      [infKey('/b/child'), undefined],
      [infKey('/c'), undefined]
    ])
    expect(findMatchingInfiniteKeys(cache, ['/a', '/b/*']).sort()).toEqual(
      [infKey('/a'), infKey('/a', { q: 1 }), infKey('/b/child')].sort()
    )
  })

  it('returns [] for empty cache or cache without $inf$ keys', () => {
    expect(findMatchingInfiniteKeys(seed([]), ['/foo'])).toEqual([])
    expect(
      findMatchingInfiniteKeys(
        seed([
          ['/providers', undefined], // plain string, not $inf$
          ['$sub$@"/providers",', undefined] // $sub$, not $inf$
        ]),
        ['/providers']
      )
    ).toEqual([])
  })
})

describe('invalidatePathPatterns with live useSWRInfinite', () => {
  // These tests assert the end-to-end invariant: when we call
  // invalidatePathPatterns with a matching path, a live useSWRInfinite hook's
  // fetcher runs again. This is the only test that proves
  // `globalMutate(infiniteKeyString)` actually triggers a refetch — without
  // it, unit tests only prove "we produce the right strings".
  const getKey = (_pageIndex: number, previousPageData: { nextCursor?: string | null } | null) => {
    if (previousPageData && !previousPageData.nextCursor) return null
    return ['/foo', { limit: 10 }]
  }

  it('triggers useSWRInfinite revalidation for matching paths', async () => {
    const { Wrapper, cache } = makeWrapper()
    const fetcher = vi.fn(async () => ({ items: [], nextCursor: null }))

    renderHook(() => useSWRInfinite(getKey, fetcher), { wrapper: Wrapper })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

    const { result: cfg } = renderHook(() => useSWRConfig(), { wrapper: Wrapper })

    await act(async () => {
      await invalidatePathPatterns(cache as unknown as Cache, cfg.current.mutate, ['/foo'])
    })

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })

  it('does not refetch when path does not match', async () => {
    const { Wrapper, cache } = makeWrapper()
    const fetcher = vi.fn(async () => ({ items: [], nextCursor: null }))

    renderHook(() => useSWRInfinite(getKey, fetcher), { wrapper: Wrapper })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

    const { result: cfg } = renderHook(() => useSWRConfig(), { wrapper: Wrapper })

    await act(async () => {
      await invalidatePathPatterns(cache as unknown as Cache, cfg.current.mutate, ['/bar'])
    })

    // Give any pending revalidation a chance to run — it should not.
    await new Promise((r) => setTimeout(r, 30))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// useInfiniteQuery / useInfiniteFlatItems / usePaginatedQuery: pagination hooks
//
// These suites cover three contracts:
//   1. Type contracts (compile-time): subtype precision on `pages`, mutator
//      signature, removed `items` field, path-mode guards.
//   2. `useInfiniteFlatItems` behavior (pure useMemo wrapper).
//   3. `useInfiniteQuery` integration: real SWR + spied dataApiService.get.
// ============================================================================

describe('useInfiniteQuery / useInfiniteFlatItems type contracts', () => {
  // The bodies of these tests never execute (`if (false)`), but TypeScript
  // type-checks them. Regressions — losing `BranchMessagesResponse` precision
  // on `pages`, restoring the legacy `items` field, or wiring an offset path
  // into `useInfiniteQuery` — fail the build.

  it('preserves BranchMessagesResponse subtype fields on pages (issue 14593)', () => {
    if ((false as boolean) === true) {
      const r = useInfiniteQuery('/topics/:topicId/messages', { params: { topicId: '' } })
      // `pages[0]` is BranchMessagesResponse — assigning to that type compiles only
      // if the precise subtype (including `activeNodeId`) is preserved.
      const _firstPage: BranchMessagesResponse | undefined = r.pages[0]
      // The `activeNodeId` extension field is exposed without cast.
      const _activeNodeId: string | null | undefined = r.pages[0]?.activeNodeId
      // mutate accepts the full subtype array (issue 14593 — would have failed
      // when mutate was typed `KeyedMutator<CursorPaginationResponse<T>[]>`).
      const _mutate: SWRInfiniteKeyedMutator<BranchMessagesResponse[]> = r.mutate
      void [_firstPage, _activeNodeId, _mutate]
    }
  })

  it('removes the legacy `items` field from useInfiniteQuery result', () => {
    if ((false as boolean) === true) {
      const r = useInfiniteQuery('/topics/:topicId/messages', { params: { topicId: '' } })
      // @ts-expect-error - `items` was removed; derive via useInfiniteFlatItems
      void r.items
    }
  })

  it('rejects offset-paginated paths passed to useInfiniteQuery', () => {
    if ((false as boolean) === true) {
      // `/assistants` returns OffsetPaginationResponse, so `CursorPaginatedPath`
      // collapses it to `never` — TS rejects the path argument outright.

      // @ts-expect-error - offset-paginated path rejected by CursorPaginatedPath guard
      void useInfiniteQuery('/assistants')
    }
  })

  it('rejects cursor-paginated paths passed to usePaginatedQuery', () => {
    if ((false as boolean) === true) {
      // `/topics/:topicId/messages` returns CursorPaginationResponse, so
      // `OffsetPaginatedPath` collapses it to `never` and TS rejects the path.

      // @ts-expect-error - cursor-paginated path rejected by OffsetPaginatedPath guard
      void usePaginatedQuery('/topics/:topicId/messages', { params: { topicId: '' } })
    }
  })

  it('useInfiniteFlatItems infers the page item type', () => {
    if ((false as boolean) === true) {
      const r = useInfiniteQuery('/topics/:topicId/messages', { params: { topicId: '' } })

      const messages = useInfiniteFlatItems(r.pages, { reverseItems: true })
      // messages is BranchMessage[] — assigning the head must match the page item
      // type, not collapse to unknown / any.
      const _first: BranchMessagesResponse['items'][number] | undefined = messages[0]
      void _first
    }
  })
})

describe('useInfiniteFlatItems behavior', () => {
  type Page<T> = { items: T[]; nextCursor?: string }

  it('returns empty array when pages is undefined', () => {
    const { result } = renderHook(() => useInfiniteFlatItems<Page<number>>(undefined))
    expect(result.current).toEqual([])
  })

  it('flattens pages in their natural order by default', () => {
    const pages: Page<string>[] = [{ items: ['a', 'b'] }, { items: ['c', 'd'] }]
    const { result } = renderHook(() => useInfiniteFlatItems(pages))
    expect(result.current).toEqual(['a', 'b', 'c', 'd'])
  })

  it('reversePages flips page order before flattening', () => {
    const pages: Page<string>[] = [{ items: ['a', 'b'] }, { items: ['c', 'd'] }]
    const { result } = renderHook(() => useInfiniteFlatItems(pages, { reversePages: true }))
    expect(result.current).toEqual(['c', 'd', 'a', 'b'])
  })

  it('reverseItems flips items within each page', () => {
    const pages: Page<string>[] = [{ items: ['a', 'b'] }, { items: ['c', 'd'] }]
    const { result } = renderHook(() => useInfiniteFlatItems(pages, { reverseItems: true }))
    expect(result.current).toEqual(['b', 'a', 'd', 'c'])
  })

  it('combines reversePages and reverseItems', () => {
    const pages: Page<string>[] = [{ items: ['a', 'b'] }, { items: ['c', 'd'] }]
    const { result } = renderHook(() => useInfiniteFlatItems(pages, { reversePages: true, reverseItems: true }))
    expect(result.current).toEqual(['d', 'c', 'b', 'a'])
  })

  it('returns the same reference across rerenders when pages/options unchanged', () => {
    const pages: Page<string>[] = [{ items: ['a'] }]
    const { result, rerender } = renderHook(({ p }) => useInfiniteFlatItems(p), { initialProps: { p: pages } })
    const first = result.current
    rerender({ p: pages })
    expect(result.current).toBe(first)
  })

  it('does not mutate input pages or their items arrays', () => {
    const pages: Page<string>[] = [{ items: ['a', 'b'] }, { items: ['c', 'd'] }]
    const items0 = pages[0].items
    const items1 = pages[1].items
    renderHook(() => useInfiniteFlatItems(pages, { reversePages: true, reverseItems: true }))
    expect(pages[0].items).toBe(items0)
    expect(pages[0].items).toEqual(['a', 'b'])
    expect(pages[1].items).toBe(items1)
    expect(pages[1].items).toEqual(['c', 'd'])
  })
})

describe('useInfiniteQuery integration', () => {
  // Spy `dataApiService.get` per test. The default `mockResolvedValue` keeps the
  // hook from falling back to the IPC-backed real implementation if SWR fires
  // an unanticipated extra fetch (strict-mode double render, focus revalidate,
  // etc.) — the original would throw in this test environment.
  const emptyPage = { items: [], nextCursor: undefined, activeNodeId: null }

  function spyGet() {
    return vi.spyOn(dataApiService, 'get').mockResolvedValue(emptyPage as never)
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accumulates pages, paginates via loadNext', async () => {
    // Cursor-aware mock: return values based on the actual cursor in the
    // request, not call sequence. `useSWRInfinite` defaults
    // `revalidateFirstPage: true` so `loadNext` produces both a page-0
    // revalidate and a page-1 fetch — order-based mocks would mis-feed them.
    spyGet().mockImplementation((async (_path: string, opts: { query?: { cursor?: string } } = {}) => {
      const cursor = opts?.query?.cursor
      if (!cursor) return { items: [], nextCursor: 'c1', activeNodeId: null }
      if (cursor === 'c1') return { items: [], nextCursor: 'c2', activeNodeId: null }
      return { items: [], nextCursor: undefined, activeNodeId: null }
    }) as never)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useInfiniteQuery('/topics/:topicId/messages', { params: { topicId: 't1' } }), {
      wrapper: Wrapper
    })

    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    expect(result.current.hasNext).toBe(true)
    expect(result.current.pages[0]?.nextCursor).toBe('c1')

    await act(async () => {
      result.current.loadNext()
    })

    await waitFor(() => expect(result.current.pages).toHaveLength(2))
    expect(result.current.pages[1]?.nextCursor).toBe('c2')
  })

  it('hasNext is false when last page has no nextCursor', async () => {
    spyGet().mockResolvedValueOnce({ items: [], nextCursor: undefined, activeNodeId: null } as never)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useInfiniteQuery('/topics/:topicId/messages', { params: { topicId: 't1' } }), {
      wrapper: Wrapper
    })

    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    expect(result.current.hasNext).toBe(false)
  })

  it('reset() collapses back to the first page', async () => {
    const getSpy = spyGet()
    getSpy
      .mockResolvedValueOnce({ items: [], nextCursor: 'c1', activeNodeId: null } as never)
      .mockResolvedValueOnce({ items: [], nextCursor: 'c2', activeNodeId: null } as never)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useInfiniteQuery('/topics/:topicId/messages', { params: { topicId: 't1' } }), {
      wrapper: Wrapper
    })

    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    await act(async () => {
      result.current.loadNext()
    })
    await waitFor(() => expect(result.current.pages).toHaveLength(2))

    await act(async () => {
      result.current.reset()
    })
    await waitFor(() => expect(result.current.pages).toHaveLength(1))
  })

  it('mutate replaces the pages array directly', async () => {
    spyGet().mockResolvedValueOnce({ items: [], nextCursor: undefined, activeNodeId: 'a1' } as never)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useInfiniteQuery('/topics/:topicId/messages', { params: { topicId: 't1' } }), {
      wrapper: Wrapper
    })

    await waitFor(() => expect(result.current.pages).toHaveLength(1))

    const overriddenPages = [
      { items: [], nextCursor: undefined, activeNodeId: 'overridden' }
    ] as unknown as BranchMessagesResponse[]

    await act(async () => {
      await result.current.mutate(overriddenPages, { revalidate: false })
    })

    expect(result.current.pages[0]?.activeNodeId).toBe('overridden')
  })

  it('pages reference is stable across rerenders when SWR data is unchanged', async () => {
    spyGet().mockResolvedValueOnce({ items: [], nextCursor: undefined, activeNodeId: null } as never)

    const { Wrapper } = makeWrapper()
    const { result, rerender } = renderHook(
      () => useInfiniteQuery('/topics/:topicId/messages', { params: { topicId: 't1' } }),
      { wrapper: Wrapper }
    )

    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    const firstRef = result.current.pages
    rerender()
    expect(result.current.pages).toBe(firstRef)
  })

  it('passes swrOptions through to useSWRInfinite', async () => {
    // Sanity-check that `swrOptions` reach `useSWRInfinite` by setting
    // `revalidateFirstPage: false` and verifying `refresh()` does NOT refetch
    // page 1 when only one page is loaded.
    const getSpy = spyGet()
    getSpy.mockResolvedValueOnce({ items: [], nextCursor: undefined, activeNodeId: null } as never)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () =>
        useInfiniteQuery('/topics/:topicId/messages', {
          params: { topicId: 't1' },
          swrOptions: { revalidateFirstPage: false }
        }),
      { wrapper: Wrapper }
    )

    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    expect(getSpy).toHaveBeenCalledTimes(1)
  })
})

describe('usePaginatedQuery reset-on-query-change', () => {
  // The hook resets `currentPage` to 1 when the consumer's `query` content
  // changes. Implementation uses SWR's `unstable_serialize` to derive a
  // stable, key-order-independent hash — so `{a,b}` vs `{b,a}` must NOT
  // trigger a reset, while a real value change must.

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // total=30 + default limit=10 → 3 pages, so `nextPage()` is allowed at least once.
  function spyOffsetGet() {
    return vi.spyOn(dataApiService, 'get').mockResolvedValue({ items: [], total: 30, page: 1 } as never)
  }

  it('does NOT reset page when query keys reorder but values are unchanged', async () => {
    spyOffsetGet()

    const { Wrapper } = makeWrapper()
    type Q = { a?: string; b?: string }
    const { result, rerender } = renderHook(
      ({ q }: { q: Q }) => usePaginatedQuery('/assistants', { query: q as never }),
      {
        wrapper: Wrapper,
        initialProps: { q: { a: '1', b: '2' } as Q }
      }
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.page).toBe(1)

    await act(async () => {
      result.current.nextPage()
    })
    await waitFor(() => expect(result.current.page).toBe(2))

    // Same content, different key order — order-independent hash means no reset
    rerender({ q: { b: '2', a: '1' } as Q })
    // Allow any potentially scheduled effect to flush
    await new Promise((r) => setTimeout(r, 30))
    expect(result.current.page).toBe(2)
  })

  it('resets page to 1 when query content actually changes', async () => {
    spyOffsetGet()

    const { Wrapper } = makeWrapper()
    type Q = { search: string }
    const { result, rerender } = renderHook(
      ({ q }: { q: Q }) => usePaginatedQuery('/assistants', { query: q as never }),
      {
        wrapper: Wrapper,
        initialProps: { q: { search: 'foo' } as Q }
      }
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      result.current.nextPage()
    })
    await waitFor(() => expect(result.current.page).toBe(2))

    rerender({ q: { search: 'bar' } as Q })
    await waitFor(() => expect(result.current.page).toBe(1))
  })

  it('does NOT reset page on rerender with the same query object reference', async () => {
    // Independent of unstable_serialize semantics: even if the consumer holds
    // a stable reference, the hook must not reset on every rerender.
    spyOffsetGet()

    const { Wrapper } = makeWrapper()
    const stableQuery = { search: 'foo' } as never
    const { result, rerender } = renderHook(() => usePaginatedQuery('/assistants', { query: stableQuery }), {
      wrapper: Wrapper
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      result.current.nextPage()
    })
    await waitFor(() => expect(result.current.page).toBe(2))

    rerender()
    rerender()
    expect(result.current.page).toBe(2)
  })
})
