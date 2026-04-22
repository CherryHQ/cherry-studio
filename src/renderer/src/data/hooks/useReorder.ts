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
 * On success the collection cache key (`[collectionUrl]`) is revalidated; on
 * failure it is always re-fetched from the server so the optimistic overlay
 * is discarded.
 *
 * See `docs/references/data/data-ordering-guide.md` for the end-to-end flow.
 */

import { useInvalidateCache, useMutation, useReadCache, useWriteCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { computeMinimalMoves, reorderLocally } from '@renderer/data/utils/reorder'
import type { TemplateApiPaths } from '@shared/data/api/apiPaths'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { OrderBatchRequest, OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import { useCallback, useState } from 'react'

const logger = loggerService.withContext('useReorder')

/**
 * Shape of the collection document cached under `[collectionUrl]`.
 * The optimistic path only needs `items`; any other fields are preserved as-is.
 * Item identity is read via the configured `idKey` (default `'id'`).
 */
interface CollectionCacheValue {
  items?: Array<Record<string, unknown>>
  [key: string]: unknown
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
  applyReorderedList: (reorderedList: Array<Record<string, unknown>>) => Promise<void>
  /** True while any mutation owned by this hook is in flight. */
  isPending: boolean
}

/**
 * Build optimistic drag-and-drop reorder handlers on top of `useMutation`.
 *
 * The hook assumes the collection under `collectionUrl` is reachable via
 * `useQuery(collectionUrl)` and shaped as `{ items: Array<Record<string, unknown>> }`
 * where each item exposes a string id under `idKey` (default `'id'`).
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
 * @example Default idKey (`'id'`)
 * const { data } = useQuery('/mcp-servers')
 * const { applyReorderedList } = useReorder('/mcp-servers')
 * <DraggableList items={data?.items ?? []} onReorder={applyReorderedList} />
 *
 * @example Non-'id' primary key (e.g. miniapp.appId)
 * const { data } = useQuery('/mini-apps')
 * const { applyReorderedList } = useReorder('/mini-apps', { idKey: 'appId' })
 * <DraggableList items={data?.items ?? []} onReorder={applyReorderedList} />
 */
export function useReorder<TCollection extends ConcreteApiPaths>(
  collectionUrl: TCollection,
  options?: UseReorderOptions
): UseReorderResult {
  const readCache = useReadCache()
  const writeCache = useWriteCache()
  const invalidateCache = useInvalidateCache()
  const [isPending, setIsPending] = useState(false)

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
   * Returns `undefined` when the collection has not been fetched yet — in
   * which case we skip the optimistic step and let the server response
   * populate the cache via `refresh`. Delegates to `useReadCache` so the
   * raw SWR cache / key serialization lives in one place (`useDataApi.ts`).
   */
  const readCurrent = useCallback(
    (): CollectionCacheValue | undefined => readCache<CollectionCacheValue>(collectionUrl),
    [readCache, collectionUrl]
  )

  const move = useCallback(
    async (id: string, anchor: OrderRequest) => {
      setIsPending(true)
      const current = readCurrent()
      const optimistic =
        current?.items !== undefined
          ? { ...current, items: computeOptimistic(current.items, id, anchor, idKey) }
          : undefined

      try {
        if (optimistic) {
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
    [readCurrent, computeOptimistic, idKey, writeCache, invalidateCache, collectionUrl, patchOrder]
  )

  const applyBatch = useCallback(
    async (moves: OrderBatchRequest['moves']) => {
      setIsPending(true)
      const current = readCurrent()
      let optimisticItems = current?.items
      if (optimisticItems) {
        for (const m of moves) {
          optimisticItems = computeOptimistic(optimisticItems, m.id, m.anchor, idKey)
        }
      }
      const optimistic =
        optimisticItems !== undefined && current !== undefined ? { ...current, items: optimisticItems } : undefined

      try {
        if (optimistic) {
          await writeCache(collectionUrl, optimistic)
        }
        await patchBatch({ body: { moves } } as Parameters<typeof patchBatch>[0])
      } catch (err) {
        logger.warn(`batch reorder failed for ${String(collectionUrl)}, rolling back`, { error: err })
        await invalidateCache(collectionUrl)
        throw err
      } finally {
        setIsPending(false)
      }
    },
    [readCurrent, computeOptimistic, idKey, writeCache, invalidateCache, collectionUrl, patchBatch]
  )

  const applyReorderedList = useCallback(
    async (newList: Array<Record<string, unknown>>) => {
      const current = readCurrent()?.items ?? []
      const moves = computeMinimalMoves(current, newList, idKey)
      if (moves.length === 0) return
      if (moves.length === 1) {
        return move(moves[0].id, moves[0].anchor)
      }
      return applyBatch(moves)
    },
    [readCurrent, idKey, move, applyBatch]
  )

  return { move, applyReorderedList, isPending }
}
