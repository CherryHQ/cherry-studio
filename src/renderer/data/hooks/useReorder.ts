/**
 * @fileoverview Optimistic reorder hook for sortable collections exposed via
 * DataApi.
 *
 * Sits on top of {@link useMutation} — never calls `dataApiService.*` directly
 * — and wires up the registered ordering operations:
 *
 * - `PATCH /{res}/:id/order`   — single-item move with an anchor body.
 * - `PATCH /{res}/order:batch` — multi-item move, when this endpoint is registered.
 *
 * Supports three default collection cache shapes out of the box — flat array
 * (`T[]`), wrapped pagination (`{ items, total, page }` / `{ items, nextCursor }`),
 * and naked `{ items: T[] }` — and exposes a `selectItems`/`updateItems`
 * accessor pair for nested or otherwise custom cache shapes. On success the
 * collection cache key (`[collectionUrl]`) is revalidated; on failure it is
 * always re-fetched from the server so the optimistic overlay is discarded.
 *
 * See `docs/dev/references/data/data-ordering-guide.md` for the end-to-end flow.
 */

import { useCallback, useRef, useState } from 'react'

import {
  type ParamsOption,
  useInvalidateCache,
  useMutation,
  useReadCache,
  useWriteCache,
  useWriteInfiniteCacheSnapshot
} from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { resolveTemplate } from '@renderer/data/utils/dataApiPath'
import { computeMinimalMoves, reorderLocally } from '@renderer/data/utils/reorder'
import type { BodyForPath, ConcreteApiPaths } from '@shared/data/api/paths'
import type { OrderBatchRequest, OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { ApiSchemas, GetMethodApiPaths } from '@shared/data/api/types'

const logger = loggerService.withContext('useReorder')

type SortableCollectionPath = {
  [Path in GetMethodApiPaths]: `${Path}/:id/order` extends keyof ApiSchemas
    ? ApiSchemas[`${Path}/:id/order`] extends { PATCH: { body: unknown } }
      ? Path
      : never
    : never
}[GetMethodApiPaths]

type BatchSortableCollectionPath = {
  [Path in SortableCollectionPath]: `${Path}/order:batch` extends keyof ApiSchemas
    ? ApiSchemas[`${Path}/order:batch`] extends { PATCH: { body: unknown } }
      ? Path
      : never
    : never
}[SortableCollectionPath]

type ParameterizedSortableCollectionPath = {
  [Path in SortableCollectionPath]: Path extends `${string}/:${string}` ? Path : never
}[SortableCollectionPath]

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Cached rows have heterogeneous fields; ordering checks the selected string identity and preserves every other value.
type ItemList = Array<Record<string, unknown>>

type CollectionPage = { items: ItemList }

type SingleCollectionCache = ItemList | CollectionPage

type InfiniteCollectionCache = CollectionPage[]

type CollectionCache = SingleCollectionCache | InfiniteCollectionCache

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Extra body fields belong to each endpoint; this hook reads only the anchor and forwards the remaining values unchanged.
export type ReorderRequest = OrderRequest | ({ anchor: OrderRequest } & Record<string, unknown>)

/**
 * Extract the item list from a collection cache value.
 *
 * Defaults recognize flat arrays and any object whose `items` field is an
 * array — covering `OffsetPaginationResponse`, `CursorPaginationResponse`,
 * and naked `{ items }` wrappers. Return `undefined` when the shape is not
 * recognized so the optimistic path can degrade gracefully.
 */
export type SelectItems<Cache> = (cache: Cache) => ItemList | undefined

/**
 * Rebuild a collection cache value after items have been reordered. Must be
 * the inverse of {@link SelectItems}: write back so a subsequent `selectItems`
 * call on the returned value yields the same list.
 */
export type UpdateItems<Cache> = (cache: Cache, items: ItemList) => Cache

function isItemList(value: unknown): value is ItemList {
  if (!Array.isArray(value)) return false
  const items: unknown[] = value

  return items.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
}

function isCollectionPage(value: unknown): value is CollectionPage {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && 'items' in value && isItemList(value.items)
  )
}

function isInfiniteCollectionCache(value: unknown): value is InfiniteCollectionCache {
  if (!Array.isArray(value)) return false
  const pages: unknown[] = value

  return pages.every(isCollectionPage)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- useReadCache returns an unchecked SWR snapshot; validate record items in an array or items wrapper before optimistic reordering.
function defaultSelectItems(cache: unknown): ItemList | undefined {
  if (isItemList(cache)) return cache

  return isCollectionPage(cache) ? cache.items : undefined
}

function defaultUpdateItems(cache: SingleCollectionCache, items: ItemList): SingleCollectionCache {
  return Array.isArray(cache) ? items : { ...cache, items }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Infinite SWR snapshots are unchecked; require the items-object pages produced by useInfiniteQuery before optimistic reordering.
function selectInfiniteItems(cache: unknown): ItemList | undefined {
  return isInfiniteCollectionCache(cache) ? cache.flatMap((page) => page.items) : undefined
}

function updateInfiniteItems(cache: InfiniteCollectionCache, items: ItemList): InfiniteCollectionCache {
  let offset = 0

  return cache.map((page) => {
    const nextItems = items.slice(offset, offset + page.items.length)
    offset += page.items.length

    return { ...page, items: nextItems }
  })
}

export interface UseReorderOptions<Cache = CollectionCache> {
  /** Query parameters of the collection cache to update. */
  query?: Parameters<ReturnType<typeof useReadCache>>[1]
  /** Target a useInfiniteQuery collection with the same page limit; optimistic values must remain page arrays. */
  infinite?: { limit: number }
  /**
   * Revalidate the collection key after a successful server write.
   * Defaults to `true`. Failure always revalidates regardless of this flag.
   */
  revalidateOnSuccess?: boolean
  /**
   * Name of the item field used as identity. Defaults to `'id'`.
   *
   * Pass `'appId'` (or any other field name) when the collection's primary key
   * is exposed under a different name. The same `idKey` is used consistently
   * by the internal `reorderLocally` / `computeMinimalMoves` helpers and for
   * extracting ids from the `applyReorderedList` input.
   *
   * The `id` argument to `move(id, anchor)` and the `before`/`after` anchor
   * values are already strings — callers pass the same pk value the server
   * knows, regardless of what field name it lives under on the client.
   */
  idKey?: string
  /**
   * Custom optimistic reducer. Defaults to {@link reorderLocally}.
   * Receives the current items, the moving id, the anchor, and the resolved
   * `idKey`, and full request; must return a new array — inputs must not be mutated.
   */
  computeOptimistic?: <T extends Record<string, unknown>>(
    current: T[],
    id: string,
    anchor: OrderRequest,
    idKey: string,
    request: ReorderRequest
  ) => T[]
  /**
   * Escape hatch: extract the items list from the collection cache value.
   *
   * Default recognizes flat arrays and any object with an `items` array, which
   * covers the DataApi's three current collection shapes. Provide this when
   * the cache is nested (e.g. `{ groups: [{ items }] }`), uses a different
   * field name (`{ data: [] }`), or wraps items (`{ edges: [{ node }] }`).
   *
   * Must be provided together with {@link UpdateItems}; passing one without
   * the other throws at hook construction.
   */
  selectItems?: SelectItems<Cache>
  /**
   * Escape hatch: rebuild the cache value after the items list was reordered.
   * Must be the inverse of {@link SelectItems} — see {@link UpdateItems}.
   */
  updateItems?: UpdateItems<Cache>
}

export type UseReorderResult<Path extends SortableCollectionPath = SortableCollectionPath> = {
  /** Move an item with the request body declared by this collection's order endpoint. */
  move: (id: string, request: BodyForPath<`${Path}/:id/order`, 'PATCH'>) => Promise<void>
  isPending: boolean
} & (Path extends BatchSortableCollectionPath ? { applyReorderedList: (reorderedList: ItemList) => Promise<void> } : {})

type ReorderParamsOptions = {
  [Path in SortableCollectionPath]: ParamsOption<Path, 'GET'> extends infer TParams
    ? TParams extends { params: infer TPathParams }
      ? 'id' extends keyof TPathParams
        ? never
        : TParams
      : TParams
    : never
}

type ReorderParamsOption<Path extends SortableCollectionPath> = ReorderParamsOptions[Path]

type ReorderArgs<Cache> = {
  [Path in SortableCollectionPath]: Path extends ParameterizedSortableCollectionPath
    ? [collectionUrl: Path, options: UseReorderOptions<Cache> & ReorderParamsOption<Path>]
    : [collectionUrl: Path, options?: UseReorderOptions<Cache> & ReorderParamsOption<Path>]
}[SortableCollectionPath]

/**
 * Build optimistic drag-and-drop reorder handlers on top of `useMutation`.
 *
 * The hook assumes the collection under `collectionUrl` is reachable via
 * `useQuery(collectionUrl)`. It supports three cache shapes out of the box:
 *
 * - **Flat array** `T[]` — e.g. `GET /pins`, `GET /groups`, `GET /tags`
 * - **Wrapped pagination** `{ items, total, page }` or `{ items, nextCursor }`
 *   — e.g. `GET /mini-apps`, `GET /mcp-servers`, `GET /assistants`
 * - **Naked items wrapper** `{ items: T[] }` — e.g. `GET /knowledges/:id/items`
 *
 * For nested or otherwise custom shapes (grouped views, GraphQL connections,
 * envelopes with a different field name), pass `options.selectItems` and
 * `options.updateItems` together.
 *
 * Each item must expose a string id under `idKey` (default `'id'`).
 *
 * ### Degradation
 *
 * | Precondition | `move` / `applyBatch` | `applyReorderedList` |
 * | --- | --- | --- |
 * | Cache not yet loaded | skip PATCH, warn, return | skip PATCH, warn, return |
 * | Cache loaded but shape unrecognized | skip optimistic, PATCH still fires | skip PATCH, warn, return |
 *
 * "Not loaded" is a UX timing bug (the user dragged before data arrived) and
 * always no-ops. "Unrecognized shape" is a caller contract issue — `move` can
 * still safely reach the server because its `id` / `anchor` arguments are
 * self-contained, but `applyReorderedList` refuses to fire since there is no
 * current baseline to diff against.
 *
 * Optimistic writes go through {@link useWriteCache} (which wraps SWR's
 * `mutate(key, value, false)`) because {@link useMutation}'s `optimisticData`
 * option is static and cannot express a value derived from (current cache +
 * anchor). Rollback on error goes through {@link useInvalidateCache}.
 *
 * Collections must declare their GET and single-item order endpoint in ApiSchemas.
 * Whole-list reordering is exposed only when the batch endpoint is also registered.
 *
 * @example Flat-array collection
 * const { data } = useQuery('/pins')
 * const { applyReorderedList } = useReorder('/pins')
 * <ReorderableList items={data ?? []} getId={getId} renderItem={renderRow} onReorder={applyReorderedList} />
 *
 * @example Paginated collection (items live under `.items`)
 * const { data } = useQuery('/mini-apps')
 * const { applyReorderedList } = useReorder('/mini-apps', { idKey: 'appId' })
 * <ReorderableList items={data?.items ?? []} getId={getId} renderItem={renderRow} onReorder={applyReorderedList} />
 *
 * @example Nested group view via accessors
 * const { applyReorderedList } = useReorder('/assistants', {
 *   selectItems: (cache: GroupedView) => cache.groups[0].items,
 *   updateItems: (cache, items) => {
 *     return { ...cache, groups: [{ ...cache.groups[0], items }, ...cache.groups.slice(1)] }
 *   }
 * })
 */
export function useReorder<TCollection extends ParameterizedSortableCollectionPath, Cache = CollectionCache>(
  collectionUrl: TCollection,
  options: UseReorderOptions<Cache> & ReorderParamsOption<TCollection>
): UseReorderResult<TCollection>
export function useReorder<
  TCollection extends Exclude<SortableCollectionPath, ParameterizedSortableCollectionPath>,
  Cache = CollectionCache
>(collectionUrl: TCollection, options?: UseReorderOptions<Cache>): UseReorderResult<TCollection>
export function useReorder<Cache>(
  collectionUrl: SortableCollectionPath,
  options?: ReorderArgs<Cache>[1]
): UseReorderResult {
  const hasSelect = options?.selectItems !== undefined
  const hasUpdate = options?.updateItems !== undefined

  if (hasSelect !== hasUpdate) {
    throw new Error('useReorder: options.selectItems and options.updateItems must be provided together')
  }

  const selectItems = options?.selectItems ?? (options?.infinite ? selectInfiniteItems : defaultSelectItems)

  const updateItems = useCallback(
    (cache: Cache, items: ItemList) => {
      if (options?.updateItems) return options.updateItems(cache, items)

      if (options?.infinite) {
        // oxlint-disable-next-line anti-slop/no-known-value-widening -- SWR's caller-defined Cache is unchecked; the fallback must recognize item pages before rebuilding them.
        return isInfiniteCollectionCache(cache) ? updateInfiniteItems(cache, items) : undefined
      }

      // oxlint-disable-next-line anti-slop/no-known-value-widening -- Without custom accessors, only a validated row list or items wrapper can receive the optimistic update.
      return isItemList(cache) || isCollectionPage(cache) ? defaultUpdateItems(cache, items) : undefined
    },
    [options?.updateItems, options?.infinite]
  )

  const readCache = useReadCache()
  const writeCache = useWriteCache()
  const invalidateCache = useInvalidateCache()
  const [isPending, setIsPending] = useState(false)

  // De-duplicate the "unrecognized shape" warning across the lifetime of a
  // single hook instance — the condition is configuration-level (caller did
  // not provide selectItems/updateItems for a nested cache), so logging it
  // on every drag would be noise. "Not loaded" warnings are NOT de-duped
  // because each occurrence is an independent UX timing event worth seeing.
  const unrecognizedWarnedRef = useRef(false)

  const revalidate = options?.revalidateOnSuccess !== false
  const idKey = options?.idKey ?? 'id'
  const computeOptimistic = options?.computeOptimistic ?? reorderLocally
  const mutationParams = options?.params

  if (mutationParams && Object.hasOwn(mutationParams, 'id')) {
    throw new Error('useReorder: collection params must not use the reserved item parameter "id"')
  }

  // SAFETY: Resolution only substitutes this schema-owned collection's declared GET params.
  const resolvedCollectionUrl = resolveTemplate(collectionUrl, mutationParams) as ConcreteApiPaths
  const query = options?.query
  const infinite = options?.infinite

  const writeInfiniteCache = useWriteInfiniteCacheSnapshot(resolvedCollectionUrl, { query, limit: infinite?.limit })

  const writeCurrent = useCallback(
    async (value: Cache | CollectionCache) => {
      if (infinite) {
        if (Array.isArray(value)) await writeInfiniteCache(value)
      } else await writeCache(resolvedCollectionUrl, value, query)
    },
    [infinite, writeInfiniteCache, writeCache, resolvedCollectionUrl, query]
  )

  const orderPath = `${collectionUrl}/:id/order` as const
  const batchPath = collectionUrl === '/knowledge-bases' ? null : (`${collectionUrl}/order:batch` as const)

  const { trigger: patchOrder } = useMutation(
    'PATCH',
    orderPath,
    revalidate ? { refresh: [resolvedCollectionUrl] } : undefined
  )

  const { trigger: patchBatch } = useMutation(
    'PATCH',
    batchPath,
    revalidate ? { refresh: [resolvedCollectionUrl] } : undefined
  )

  const warnUnrecognizedShape = useCallback(
    (source: string) => {
      if (unrecognizedWarnedRef.current) return
      unrecognizedWarnedRef.current = true
      logger.warn(
        `${source}: cache at ${String(collectionUrl)} has unrecognized shape; ` +
          `provide options.selectItems/updateItems or use a flat array / { items } response`
      )
    },
    [collectionUrl]
  )

  const move = useCallback(
    async (id: string, request: ReorderRequest) => {
      const current = readCache<Cache>(resolvedCollectionUrl, query, infinite)

      if (current === undefined) {
        logger.warn(`move called before data loaded at ${String(collectionUrl)}; ignored`)

        return
      }

      const anchor = 'anchor' in request ? request.anchor : request
      const items = selectItems(current)

      const optimistic =
        items !== undefined ? updateItems(current, computeOptimistic(items, id, anchor, idKey, request)) : undefined

      if (items === undefined) warnUnrecognizedShape('move')

      setIsPending(true)

      try {
        if (optimistic !== undefined) {
          await writeCurrent(optimistic)
        }

        await patchOrder({ params: { ...mutationParams, id }, body: request })
      } catch (err) {
        logger.warn(`move failed for ${String(collectionUrl)} id=${id}, rolling back`, { error: err })
        // Rollback regardless of `revalidateOnSuccess` — the optimistic
        // overlay must never outlive a rejected server write.
        await invalidateCache(resolvedCollectionUrl)
        throw err
      } finally {
        setIsPending(false)
      }
    },
    [
      readCache,
      query,
      infinite,
      selectItems,
      updateItems,
      computeOptimistic,
      idKey,
      writeCurrent,
      invalidateCache,
      collectionUrl,
      mutationParams,
      patchOrder,
      resolvedCollectionUrl,
      warnUnrecognizedShape
    ]
  )

  const applyBatch = useCallback(
    // Internal: the only caller is `applyReorderedList`, which has already
    // verified the cache is loaded and that `selectItems` returns a list.
    async (current: Cache, items: ItemList, moves: OrderBatchRequest['moves']) => {
      setIsPending(true)
      let next = items

      for (const m of moves) {
        next = computeOptimistic(next, m.id, m.anchor, idKey, m.anchor)
      }

      const optimistic = updateItems(current, next)

      try {
        if (optimistic !== undefined) await writeCurrent(optimistic)

        if (mutationParams) await patchBatch({ params: mutationParams, body: { moves } })
        else await patchBatch({ body: { moves } })
      } catch (err) {
        logger.warn(`batch reorder failed for ${String(collectionUrl)}, rolling back`, { error: err })
        await invalidateCache(resolvedCollectionUrl)
        throw err
      } finally {
        setIsPending(false)
      }
    },
    [
      updateItems,
      computeOptimistic,
      idKey,
      writeCurrent,
      invalidateCache,
      collectionUrl,
      mutationParams,
      patchBatch,
      resolvedCollectionUrl
    ]
  )

  const applyReorderedList = useCallback(
    async (newList: ItemList) => {
      const current = readCache<Cache>(resolvedCollectionUrl, query, infinite)

      if (current === undefined) {
        logger.warn(`applyReorderedList called before data loaded at ${String(collectionUrl)}; ignored`)

        return
      }

      const items = selectItems(current)

      if (items === undefined) {
        warnUnrecognizedShape('applyReorderedList')

        return
      }

      const moves = computeMinimalMoves(items, newList, idKey)

      if (moves.length === 0) return

      if (moves.length === 1) {
        return move(moves[0].id, moves[0].anchor)
      }

      return applyBatch(current, items, moves)
    },
    [
      readCache,
      resolvedCollectionUrl,
      query,
      infinite,
      selectItems,
      idKey,
      move,
      applyBatch,
      collectionUrl,
      warnUnrecognizedShape
    ]
  )

  return batchPath === null ? { move, isPending } : { move, applyReorderedList, isPending }
}
