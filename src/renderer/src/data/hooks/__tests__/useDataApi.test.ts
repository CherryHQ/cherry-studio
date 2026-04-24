import type * as RendererConstantModule from '@renderer/config/constant'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import { act, renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import type { Cache } from 'swr'
import useSWR, { SWRConfig, unstable_serialize, useSWRConfig } from 'swr'
import useSWRInfinite, { unstable_serialize as unstable_serialize_infinite } from 'swr/infinite'
import { describe, expect, it, vi } from 'vitest'

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

import { __testing, useReadCache, useWriteCache } from '../useDataApi'

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
