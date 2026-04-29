/**
 * @fileoverview Optimistic reorder hook for sortable collections exposed via
 * DataApi.
 *
 * Sits on top of {@link useMutation} — never calls `dataApiService.*` directly
 * — and wires up the two request flavours the server side exposes for any
 * sortable resource:
 *
 * - `PATCH /{res}/:id/order`   — single-item move with an anchor body.
 * - `PATCH /{res}/order:batch` — multi-item move ordered by dependency.
 *
 * Supports three default collection cache shapes out of the box — flat array
 * (`T[]`), wrapped pagination (`{ items, total, page }` / `{ items, nextCursor }`),
 * and naked `{ items: T[] }` — and exposes a `selectItems`/`updateItems`
 * accessor pair for nested or otherwise custom cache shapes. On success the
 * collection cache key (`[collectionUrl]`) is revalidated; on failure it is
 * always re-fetched from the server so the optimistic overlay is discarded.
 *
 * See `docs/references/data/data-ordering-guide.md` for the end-to-end flow.
 */

import { useInvalidateCache, useMutation, useReadCache, useWriteCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { computeMinimalMoves, reorderLocally } from '@renderer/data/utils/reorder'
import type { TemplateApiPaths } from '@shared/data/api/apiPaths'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { OrderBatchRequest, OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import { useCallback, useRef, useState } from 'react'

const logger = loggerService.withContext('useReorder')

type ItemList = Array<Record<string, unknown>>

/**
 * Extract the item list from a collection cache value.
 *
 * Defaults recognize flat arrays and any object whose `items` field is an
 * array — covering `OffsetPaginationResponse`, `CursorPaginationResponse`,
 * and naked `{ items }` wrappers. Return `undefined` when the shape is not
 * recognized so the optimistic path can degrade gracefully.
 */
export type SelectItems = (cache: unknown) => ItemList | undefined

/**
 * Rebuild a collection cache value after items have been reordered. Must be
 * the inverse of {@link SelectItems}: write back so a subsequent `selectItems`
 * call on the returned value yields the same list.
 */
export type UpdateItems = (cache: unknown, items: ItemList) => unknown

function defaultSelectItems(cache: unknown): ItemList | undefined {
  if (cache === undefined || cache === null) return undefined
  if (Array.isArray(cache)) return cache as ItemList
  if (typeof cache === 'object' && 'items' in cache) {
    const items = (cache as { items?: unknown }).items
    if (Array.isArray(items)) return items as ItemList
  }
  return undefined
}

function defaultUpdateItems(cache: unknown, items: ItemList): unknown {
  if (Array.isArray(cache)) return items
  if (cache !== null && typeof cache === 'object') {
    return { ...(cache as Record<string, unknown>), items }
  }
  // Reached only when the caller bypasses the not-loaded guard with an
  // accessor-less call on a primitive cache value — fall back to the items
  // array so downstream writes still make forward progress.
  return items
}

export interface UseReorderOptions {
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
   * `idKey`; must return a new array — inputs must not be mutated.
   */
  computeOptimistic?: <T extends Record<string, unknown>>(
    current: T[],
    id: string,
    anchor: OrderRequest,
    idKey: string
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
  selectItems?: SelectItems
  /**
   * Escape hatch: rebuild the cache value after the items list was reordered.
   * Must be the inverse of {@link SelectItems} — see {@link UpdateItems}.
   */
  updateItems?: UpdateItems
}

export interface UseReorderResult {
  /** Move a single item to a new slot described by `anchor`. */
  move: (id: string, anchor: OrderRequest) => Promise<void>
  /**
   * Drop-in callback for dnd libraries: accepts the fully reordered list and
   * internally diffs it against the cached collection, dispatching either a
   * single `move` or a batch PATCH depending on how many positions changed.
   * Items are identified by `idKey` (default `'id'`).
   */
  applyReorderedList: (reorderedList: ItemList) => Promise<void>
  /** True while any mutation owned by this hook is in flight. */
  isPending: boolean
}

/**
 * Build optimistic drag-and-drop reorder handlers on top of `useMutation`.
 *
 * The hook assumes the collection under `collectionUrl` is reachable via
 * `useQuery(collectionUrl)`. It supports three cache shapes out of the box:
 *
 * - **Flat array** `T[]` — e.g. `GET /pins`, `GET /groups`, `GET /tags`
 * - **Wrapped pagination** `{ items, total, page }` or `{ items, nextCursor }`
 *   — e.g. `GET /miniapps`, `GET /mcp-servers`, `GET /assistants`
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
 * Known bounded tech debt: the single-item and batch endpoints are typed via
 * `as TemplateApiPaths` / `as ConcreteApiPaths` casts. Each consumer resource
 * must register `/{res}/:id/order` and `/{res}/order:batch` in `ApiSchemas`
 * to eventually remove the casts; the cast surface is confined to this hook.
 *
 * @example Flat-array collection
 * const { data } = useQuery('/pins')
 * const { applyReorderedList } = useReorder('/pins')
 * <DraggableList items={data ?? []} onReorder={applyReorderedList} />
 *
 * @example Paginated collection (items live under `.items`)
 * const { data } = useQuery('/miniapps')
 * const { applyReorderedList } = useReorder('/miniapps', { idKey: 'appId' })
 * <DraggableList items={data?.items ?? []} onReorder={applyReorderedList} />
 *
 * @example Nested group view via accessors
 * const { applyReorderedList } = useReorder('/grouped-view', {
 *   selectItems: (cache) => (cache as GroupedView).groups[0].items,
 *   updateItems: (cache, items) => {
 *     const c = cache as GroupedView
 *     return { ...c, groups: [{ ...c.groups[0], items }, ...c.groups.slice(1)] }
 *   }
 * })
 */
export function useReorder<TCollection extends ConcreteApiPaths>(
  collectionUrl: TCollection,
  options?: UseReorderOptions
): UseReorderResult {
  const hasSelect = options?.selectItems !== undefined
  const hasUpdate = options?.updateItems !== undefined
  if (hasSelect !== hasUpdate) {
    throw new Error('useReorder: options.selectItems and options.updateItems must be provided together')
  }
  const selectItems = options?.selectItems ?? defaultSelectItems
  const updateItems = options?.updateItems ?? defaultUpdateItems

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

  // Template path `${collectionUrl}/:id/order` is not yet registered in
  // ApiSchemas for arbitrary resources, so we widen via `TemplateApiPaths`.
  // The cast is confined to this hook — callers receive the strict
  // `OrderRequest` / `OrderBatchRequest` types from the public surface.
  const { trigger: patchOrder } = useMutation(
    'PATCH',
    `${collectionUrl}/:id/order` as TemplateApiPaths,
    revalidate ? { refresh: [collectionUrl] } : undefined
  )

  const { trigger: patchBatch } = useMutation(
    'PATCH',
    `${collectionUrl}/order:batch` as ConcreteApiPaths,
    revalidate ? { refresh: [collectionUrl] } : undefined
  )

  /**
   * Snapshot-read the current collection value without subscribing.
   * Returns `undefined` when the collection has not been fetched yet — the
   * caller distinguishes this from an unrecognized shape.
   */
  const readCurrent = useCallback((): unknown => readCache<unknown>(collectionUrl), [readCache, collectionUrl])

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
    async (id: string, anchor: OrderRequest) => {
      const current = readCurrent()
      if (current === undefined) {
        logger.warn(`move called before data loaded at ${String(collectionUrl)}; ignored`)
        return
      }

      setIsPending(true)
      const items = selectItems(current)
      const optimistic =
        items !== undefined ? updateItems(current, computeOptimistic(items, id, anchor, idKey)) : undefined
      if (items === undefined) warnUnrecognizedShape('move')

      try {
        if (optimistic !== undefined) {
          await writeCache(collectionUrl, optimistic)
        }
        await patchOrder({ params: { id }, body: anchor } as Parameters<typeof patchOrder>[0])
      } catch (err) {
        logger.warn(`move failed for ${String(collectionUrl)} id=${id}, rolling back`, { error: err })
        // Rollback regardless of `revalidateOnSuccess` — the optimistic
        // overlay must never outlive a rejected server write.
        await invalidateCache(collectionUrl)
        throw err
      } finally {
        setIsPending(false)
      }
    },
    [
      readCurrent,
      selectItems,
      updateItems,
      computeOptimistic,
      idKey,
      writeCache,
      invalidateCache,
      collectionUrl,
      patchOrder,
      warnUnrecognizedShape
    ]
  )

  const applyBatch = useCallback(
    // Internal: the only caller is `applyReorderedList`, which has already
    // verified the cache is loaded and that `selectItems` returns a list.
    async (current: unknown, items: ItemList, moves: OrderBatchRequest['moves']) => {
      setIsPending(true)
      let next = items
      for (const m of moves) {
        next = computeOptimistic(next, m.id, m.anchor, idKey)
      }
      const optimistic = updateItems(current, next)

      try {
        await writeCache(collectionUrl, optimistic)
        await patchBatch({ body: { moves } } as Parameters<typeof patchBatch>[0])
      } catch (err) {
        logger.warn(`batch reorder failed for ${String(collectionUrl)}, rolling back`, { error: err })
        await invalidateCache(collectionUrl)
        throw err
      } finally {
        setIsPending(false)
      }
    },
    [updateItems, computeOptimistic, idKey, writeCache, invalidateCache, collectionUrl, patchBatch]
  )

  const applyReorderedList = useCallback(
    async (newList: ItemList) => {
      const current = readCurrent()
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
    [readCurrent, selectItems, idKey, move, applyBatch, collectionUrl, warnUnrecognizedShape]
  )

  return { move, applyReorderedList, isPending }
}
