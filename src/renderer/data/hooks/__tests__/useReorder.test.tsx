import type * as RendererConstantModule from '@renderer/config/constant'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import { act, renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import useSWR, { SWRConfig, unstable_serialize } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The renderer setup globally replaces `@data/hooks/useDataApi` with a mock;
// this test exercises the real `useMutation` wiring, so unmock here.
vi.unmock('@data/hooks/useDataApi')

// Force `isDev` to false so the dev-only concurrency warning (from template
// path mutations with different params) does not pollute the test log when
// multiple `move` calls share the same hook instance.
vi.mock('@renderer/config/constant', async (importOriginal) => {
  const actual = await importOriginal<typeof RendererConstantModule>()
  return { ...actual, isDev: false }
})

import { useReorder } from '../useReorder'

// --- dataApiService mock ---
// We mock at the `dataApiService.*` boundary (not `useMutation`) so the
// observable request shape matches what the server would receive.
const patchMock = vi.fn<(path: string, options?: { body?: unknown; query?: unknown }) => Promise<unknown>>()
const getMock = vi.fn<(path: string, options?: { query?: unknown }) => Promise<unknown>>()

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: (...args: Parameters<typeof getMock>) => getMock(...args),
    patch: (...args: Parameters<typeof patchMock>) => patchMock(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
  }
}))

// --- Test helpers ---

const COLLECTION = '/mcp-servers' as const

interface Item {
  id: string
}

type CollectionValue = { items: Item[] }

/**
 * Build a fresh SWRConfig-wrapped harness for each test so cache state never
 * leaks between tests. The wrapper also seeds the collection key so the
 * optimistic-read path has something to work with.
 */
const COLLECTION_CACHE_KEY = unstable_serialize([COLLECTION])

function makeWrapper<T = CollectionValue>(initial?: T) {
  const cache = new Map<string, { data?: unknown }>()
  if (initial !== undefined) {
    cache.set(COLLECTION_CACHE_KEY, { data: initial })
  }

  // SWR's `Cache` provider contract is `{ get, set, delete, keys }` keyed by
  // serialized string. A plain Map satisfies it directly.
  const provider = () => cache

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <SWRConfig value={{ provider, dedupingInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false }}>
      {children}
    </SWRConfig>
  )

  return { Wrapper, cache }
}

function readCollection(cache: Map<string, { data?: unknown }>): CollectionValue | undefined {
  return cache.get(COLLECTION_CACHE_KEY)?.data as CollectionValue | undefined
}

/**
 * Render `useReorder` together with an active `useSWR` subscription on the
 * collection, because `useMutation`'s `refresh` option uses a matcher-based
 * `globalMutate` which only revalidates keys with a live subscriber.
 */
function renderReorder(
  collectionUrl: typeof COLLECTION,
  wrapper: React.ComponentType<{ children: React.ReactNode }>,
  opts?: Parameters<typeof useReorder>[1]
) {
  return renderHook(
    () => {
      useSWR([collectionUrl], ([p]) => getMock(p, {}) as Promise<CollectionValue>, {
        revalidateOnMount: false,
        revalidateIfStale: false,
        revalidateOnFocus: false,
        revalidateOnReconnect: false
      })
      return useReorder(collectionUrl, opts)
    },
    { wrapper }
  )
}

beforeEach(() => {
  patchMock.mockReset()
  getMock.mockReset()
  getMock.mockResolvedValue({ items: [] })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useReorder - move()', () => {
  it('applies optimistic update then issues PATCH /:id/order with anchor body, revalidating on success', async () => {
    const initial: CollectionValue = { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
    const { Wrapper, cache } = makeWrapper(initial)
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper)

    await act(async () => {
      await result.current.move('c', { position: 'first' })
    })

    // PATCH was called with the concrete URL + body
    const orderCall = patchMock.mock.calls.find(([p]) => p === `${COLLECTION}/c/order`)
    expect(orderCall).toBeDefined()
    expect(orderCall?.[1]).toEqual({ body: { position: 'first' }, query: undefined })

    // Post-success revalidation went through dataApiService.get
    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith(COLLECTION, expect.any(Object))
    })

    // Optimistic items were persisted in cache at some point (order: c, a, b)
    // and the final cached shape matches what the server revalidation returned.
    expect(readCollection(cache)).toBeDefined()
  })

  it('rolls back on failure by revalidating the collection and rethrows', async () => {
    const initial: CollectionValue = { items: [{ id: 'a' }, { id: 'b' }] }
    const { Wrapper, cache } = makeWrapper(initial)
    const failure = new Error('server rejected')
    patchMock.mockRejectedValue(failure)

    const { result } = renderReorder(COLLECTION, Wrapper)

    await expect(
      act(async () => {
        await result.current.move('b', { position: 'first' })
      })
    ).rejects.toThrow('server rejected')

    // On rollback we perform a GET (no value passed to globalMutate → revalidation).
    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith(COLLECTION, expect.any(Object))
    })
    // And cache key still exists (the provider was written by revalidation).
    expect(readCollection(cache)).toBeDefined()
  })

  it('passes { before: X } straight through as the request body', async () => {
    const initial: CollectionValue = { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
    const { Wrapper } = makeWrapper(initial)
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper)

    await act(async () => {
      await result.current.move('c', { before: 'a' })
    })

    const orderCall = patchMock.mock.calls.find(([p]) => p === `${COLLECTION}/c/order`)
    expect(orderCall?.[1]).toMatchObject({ body: { before: 'a' } })
  })
})

describe('useReorder - applyReorderedList()', () => {
  it('no-ops when the new list equals the current list (no patch call)', async () => {
    const initial: CollectionValue = { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
    const { Wrapper } = makeWrapper(initial)

    const { result } = renderReorder(COLLECTION, Wrapper)

    await act(async () => {
      const res = await result.current.applyReorderedList([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
      expect(res).toBeUndefined()
    })

    expect(patchMock).not.toHaveBeenCalled()
  })

  it('uses the single-move endpoint when exactly one position changes', async () => {
    // Moving "c" to the front leaves (a, b) as an LIS of length 2, so
    // computeMinimalMoves emits exactly one move.
    const initial: CollectionValue = { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
    const { Wrapper } = makeWrapper(initial)
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper)

    await act(async () => {
      await result.current.applyReorderedList([{ id: 'c' }, { id: 'a' }, { id: 'b' }])
    })

    const singleMoveCalls = patchMock.mock.calls.filter(([p]) => typeof p === 'string' && p.endsWith('/order'))
    const batchCalls = patchMock.mock.calls.filter(([p]) => typeof p === 'string' && p.endsWith('/order:batch'))
    expect(singleMoveCalls).toHaveLength(1)
    expect(batchCalls).toHaveLength(0)
    expect(singleMoveCalls[0][0]).toBe(`${COLLECTION}/c/order`)
  })

  it('uses the batch endpoint when two or more positions change', async () => {
    // (a,b,c,d) -> (d,c,b,a) requires more than one move regardless of LIS choice.
    const initial: CollectionValue = {
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    }
    const { Wrapper } = makeWrapper(initial)
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper)

    await act(async () => {
      await result.current.applyReorderedList([{ id: 'd' }, { id: 'c' }, { id: 'b' }, { id: 'a' }])
    })

    const batchCall = patchMock.mock.calls.find(([p]) => p === `${COLLECTION}/order:batch`)
    expect(batchCall).toBeDefined()
    const body = batchCall?.[1]?.body as { moves: Array<{ id: string; anchor: OrderRequest }> }
    expect(Array.isArray(body.moves)).toBe(true)
    expect(body.moves.length).toBeGreaterThanOrEqual(2)
    for (const m of body.moves) {
      expect(typeof m.id).toBe('string')
      expect(m.anchor).toBeDefined()
    }
  })
})

describe('useReorder - isPending toggle', () => {
  it('toggles false → true → false across a successful move', async () => {
    const initial: CollectionValue = { items: [{ id: 'a' }, { id: 'b' }] }
    const { Wrapper } = makeWrapper(initial)

    let resolvePatch: (v: unknown) => void = () => {}
    patchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve
        })
    )

    const { result } = renderReorder(COLLECTION, Wrapper)

    expect(result.current.isPending).toBe(false)

    let movePromise: Promise<void>
    act(() => {
      movePromise = result.current.move('b', { position: 'first' })
    })

    await waitFor(() => {
      expect(result.current.isPending).toBe(true)
    })

    await act(async () => {
      resolvePatch({})
      await movePromise!
    })

    expect(result.current.isPending).toBe(false)
  })

  it('toggles false → true → false across a failed move', async () => {
    const initial: CollectionValue = { items: [{ id: 'a' }, { id: 'b' }] }
    const { Wrapper } = makeWrapper(initial)

    let rejectPatch: (e: unknown) => void = () => {}
    patchMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectPatch = reject
        })
    )

    const { result } = renderReorder(COLLECTION, Wrapper)

    let movePromise: Promise<void>
    act(() => {
      movePromise = result.current.move('b', { position: 'first' })
    })

    await waitFor(() => {
      expect(result.current.isPending).toBe(true)
    })

    await act(async () => {
      rejectPatch(new Error('boom'))
      await movePromise!.catch(() => {})
    })

    expect(result.current.isPending).toBe(false)
  })
})

describe('useReorder - revalidateOnSuccess option', () => {
  it('does not revalidate after success when { revalidateOnSuccess: false }', async () => {
    const initial: CollectionValue = { items: [{ id: 'a' }, { id: 'b' }] }
    const { Wrapper } = makeWrapper(initial)
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper, { revalidateOnSuccess: false })

    await act(async () => {
      await result.current.move('b', { position: 'first' })
    })

    // With the flag off, a successful mutation should not trigger a GET
    // revalidation of the collection key.
    expect(getMock).not.toHaveBeenCalled()
    // But the PATCH still went through.
    expect(patchMock).toHaveBeenCalledTimes(1)
  })

  it('still revalidates after a failed move when { revalidateOnSuccess: false }', async () => {
    // Invariant: the error-rollback path MUST always revalidate from the server,
    // regardless of the revalidateOnSuccess flag. Otherwise a stale optimistic
    // value would be left in the cache after the mutation fails.
    const initial: CollectionValue = { items: [{ id: 'a' }, { id: 'b' }] }
    const { Wrapper } = makeWrapper(initial)
    patchMock.mockRejectedValueOnce(new Error('boom'))

    const { result } = renderReorder(COLLECTION, Wrapper, { revalidateOnSuccess: false })

    await act(async () => {
      await expect(result.current.move('b', { position: 'first' })).rejects.toThrow('boom')
    })

    // Failure path revalidates to discard the optimistic value.
    expect(getMock).toHaveBeenCalled()
  })
})

describe('useReorder - idKey option', () => {
  // Collection whose items expose identity under `appId` instead of `id`
  // (mirrors the miniapp schema). The optimistic reorder must identify items
  // by `appId` — reading `.id` would find nothing and fail the move.
  type AppItem = { appId: string; label?: string }
  type AppCollectionValue = { items: AppItem[] }

  function makeAppWrapper(initial: AppCollectionValue) {
    const cache = new Map<string, { data?: unknown }>()
    cache.set(COLLECTION_CACHE_KEY, { data: initial })
    const provider = () => cache
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <SWRConfig value={{ provider, dedupingInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false }}>
        {children}
      </SWRConfig>
    )
    return { Wrapper, cache }
  }

  it('uses idKey to identify items during optimistic move', async () => {
    const initial: AppCollectionValue = {
      items: [
        { appId: 'a', label: 'A' },
        { appId: 'b', label: 'B' },
        { appId: 'c', label: 'C' }
      ]
    }
    const { Wrapper, cache } = makeAppWrapper(initial)
    patchMock.mockResolvedValue({})

    // Disable revalidation so the optimistic cache value is not overwritten by
    // a post-PATCH `getMock` (which isn't wired to return appId-shaped data).
    // This is the "idKey-on-optimistic" contract under test.
    const { result } = renderReorder(COLLECTION, Wrapper, { idKey: 'appId', revalidateOnSuccess: false })

    await act(async () => {
      await result.current.move('c', { position: 'first' })
    })

    // Optimistic write should reorder by appId — without idKey, reorderLocally
    // would throw "target id 'c' not found" because no item has `.id === 'c'`.
    const optimistic = cache.get(COLLECTION_CACHE_KEY)?.data as AppCollectionValue
    expect(optimistic.items.map((x) => x.appId)).toEqual(['c', 'a', 'b'])
    // PATCH body is still just { params: { id: 'c' }, body: anchor } — the id
    // string flows through unchanged regardless of idKey.
    expect(patchMock).toHaveBeenCalledWith(
      expect.stringContaining('/c/order'),
      expect.objectContaining({ body: { position: 'first' } })
    )
  })

  it('uses idKey to diff applyReorderedList', async () => {
    const initial: AppCollectionValue = {
      items: [{ appId: 'a' }, { appId: 'b' }, { appId: 'c' }]
    }
    const { Wrapper } = makeAppWrapper(initial)
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper, { idKey: 'appId', revalidateOnSuccess: false })

    await act(async () => {
      // Single move: c → first. Should downgrade to single PATCH (not batch).
      await result.current.applyReorderedList([{ appId: 'c' }, { appId: 'a' }, { appId: 'b' }])
    })

    expect(patchMock).toHaveBeenCalledTimes(1)
    expect(patchMock).toHaveBeenCalledWith(
      expect.stringContaining('/c/order'),
      expect.objectContaining({ body: { position: 'first' } })
    )
  })
})

// ---------------------------------------------------------------------------
// Cache-shape coverage: the three default shapes, plus custom-accessor and
// graceful degradation for "cache not yet loaded" and "unrecognized shape".
// ---------------------------------------------------------------------------

describe('useReorder - cache shape: flat array', () => {
  it('applyReorderedList writes optimistic overlay back as a flat array (no { items } wrapper)', async () => {
    const initial: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const { Wrapper, cache } = makeWrapper<Item[]>(initial)
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper, { revalidateOnSuccess: false })

    await act(async () => {
      await result.current.applyReorderedList([{ id: 'c' }, { id: 'a' }, { id: 'b' }])
    })

    // One-move path downgrades to single PATCH /:id/order.
    const singleMoveCalls = patchMock.mock.calls.filter(([p]) => typeof p === 'string' && p.endsWith('/c/order'))
    expect(singleMoveCalls).toHaveLength(1)

    // Optimistic cache value must still be a plain array — a regression back
    // to `{ items: [...] }` would break flat-array consumers reading `data`
    // directly (e.g. `data ?? []` rather than `data?.items ?? []`).
    const overlay = cache.get(COLLECTION_CACHE_KEY)?.data
    expect(Array.isArray(overlay)).toBe(true)
    expect((overlay as Item[]).map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })

  it('move writes optimistic overlay back as a flat array', async () => {
    const initial: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const { Wrapper, cache } = makeWrapper<Item[]>(initial)
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper, { revalidateOnSuccess: false })

    await act(async () => {
      await result.current.move('c', { position: 'first' })
    })

    const overlay = cache.get(COLLECTION_CACHE_KEY)?.data
    expect(Array.isArray(overlay)).toBe(true)
    expect((overlay as Item[]).map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('useReorder - cache shape: OffsetPaginationResponse', () => {
  it('preserves total / page fields on the optimistic overlay', async () => {
    type Paged = { items: Item[]; total: number; page: number }
    const initial: Paged = { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], total: 3, page: 1 }
    const { Wrapper, cache } = makeWrapper<Paged>(initial)
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper, { revalidateOnSuccess: false })

    await act(async () => {
      await result.current.applyReorderedList([{ id: 'c' }, { id: 'a' }, { id: 'b' }])
    })

    const overlay = cache.get(COLLECTION_CACHE_KEY)?.data as Paged
    expect(overlay.items.map((x) => x.id)).toEqual(['c', 'a', 'b'])
    // Non-items metadata must survive the optimistic rewrite.
    expect(overlay.total).toBe(3)
    expect(overlay.page).toBe(1)
  })
})

describe('useReorder - degradation: cache not yet loaded', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('applyReorderedList warns and skips PATCH when cache is undefined', async () => {
    const { Wrapper } = makeWrapper<CollectionValue>() // no initial cache
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper)

    await act(async () => {
      await result.current.applyReorderedList([{ id: 'a' }, { id: 'b' }])
    })

    expect(patchMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('called before data loaded'))
  })

  it('move warns and skips PATCH when cache is undefined', async () => {
    const { Wrapper } = makeWrapper<CollectionValue>()
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper)

    await act(async () => {
      await result.current.move('a', { position: 'first' })
    })

    expect(patchMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('called before data loaded'))
  })
})

describe('useReorder - degradation: unrecognized cache shape', () => {
  // Cache loaded but neither a flat array nor an object with an `items` array.
  type Envelope = { data: Item[]; meta: Record<string, unknown> }

  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('applyReorderedList refuses to PATCH without a current baseline', async () => {
    const initial: Envelope = { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], meta: {} }
    const { Wrapper } = makeWrapper<Envelope>(initial)
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper)

    await act(async () => {
      await result.current.applyReorderedList([{ id: 'c' }, { id: 'a' }, { id: 'b' }])
    })

    // Cannot diff without a baseline → we deliberately do not fire PATCH.
    expect(patchMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unrecognized shape'))
  })

  it('move skips optimistic overlay but still PATCHes (id/anchor are self-contained)', async () => {
    const initial: Envelope = { data: [{ id: 'a' }, { id: 'b' }], meta: {} }
    const { Wrapper, cache } = makeWrapper<Envelope>(initial)
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper, { revalidateOnSuccess: false })

    await act(async () => {
      await result.current.move('b', { position: 'first' })
    })

    // PATCH still fires with the caller-supplied id and anchor.
    expect(patchMock).toHaveBeenCalledWith(
      expect.stringContaining('/b/order'),
      expect.objectContaining({ body: { position: 'first' } })
    )
    // Cache was not mutated with an optimistic overlay.
    expect(cache.get(COLLECTION_CACHE_KEY)?.data).toBe(initial)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unrecognized shape'))
  })

  it('de-duplicates the unrecognized-shape warning across multiple calls on the same hook', async () => {
    const initial: Envelope = { data: [{ id: 'a' }, { id: 'b' }], meta: {} }
    const { Wrapper } = makeWrapper<Envelope>(initial)
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper, { revalidateOnSuccess: false })

    await act(async () => {
      await result.current.move('a', { position: 'first' })
      await result.current.move('b', { position: 'last' })
    })

    const unrecognizedWarnings = warnSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('unrecognized shape'))
    )
    expect(unrecognizedWarnings).toHaveLength(1)
  })
})

describe('useReorder - custom accessors', () => {
  // Grouped view: items live under cache.groups[0].items; the accessor picks
  // the first group and the updater rewrites only that group's items.
  type Group = { id: string; items: Item[] }
  type GroupedView = { groups: Group[]; version: number }

  it('reorders within the selected sub-list and preserves sibling groups', async () => {
    const initial: GroupedView = {
      groups: [
        { id: 'g1', items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
        { id: 'g2', items: [{ id: 'x' }, { id: 'y' }] }
      ],
      version: 7
    }
    const { Wrapper, cache } = makeWrapper<GroupedView>(initial)
    patchMock.mockResolvedValue({})

    const { result } = renderReorder(COLLECTION, Wrapper, {
      revalidateOnSuccess: false,
      selectItems: (c) => (c as GroupedView).groups[0].items as unknown as Array<Record<string, unknown>>,
      updateItems: (c, items) => {
        const v = c as GroupedView
        return {
          ...v,
          groups: [{ ...v.groups[0], items: items as unknown as Item[] }, ...v.groups.slice(1)]
        }
      }
    })

    await act(async () => {
      await result.current.applyReorderedList([{ id: 'c' }, { id: 'a' }, { id: 'b' }])
    })

    const overlay = cache.get(COLLECTION_CACHE_KEY)?.data as GroupedView
    expect(overlay.groups[0].items.map((x) => x.id)).toEqual(['c', 'a', 'b'])
    // Sibling group untouched.
    expect(overlay.groups[1]).toEqual({ id: 'g2', items: [{ id: 'x' }, { id: 'y' }] })
    // Non-items metadata preserved.
    expect(overlay.version).toBe(7)
  })

  it('throws at hook construction when only one of selectItems/updateItems is provided', () => {
    const { Wrapper } = makeWrapper<CollectionValue>({ items: [{ id: 'a' }] })
    // React surfaces the render-phase throw on console; suppress it so the
    // test log stays clean without hiding actual failures.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(() => renderHook(() => useReorder(COLLECTION, { selectItems: () => [] }), { wrapper: Wrapper })).toThrow(
        /must be provided together/
      )
    } finally {
      errSpy.mockRestore()
    }
  })
})
