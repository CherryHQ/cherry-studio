/**
 * Generic hook for reading and toggling pins of a given entity type.
 *
 * Each pinnable domain (models, assistants, agents, ...) wraps this with a
 * one-line shim that fixes the `entityType` literal and inherits the full
 * loader / gate / logger / error-catch surface. Doing the plumbing in one
 * place keeps all consumer hooks consistent as the pin catalog grows.
 *
 * Type narrowing: the generic extracts the Pin branch whose `entityType`
 * literal matches `T`, so `pinnedIds` and `togglePin`'s parameter inherit
 * the per-type branded id (e.g. `UniqueModelId` for `'model'`, `string`
 * UUID for `'assistant'` / `'topic'` / `'session'`).
 */

import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { CreatePinDto } from '@shared/data/api/schemas/pins'
import type { Pin, PinTargetType } from '@shared/data/types/pin'
import { useCallback, useMemo, useRef } from 'react'

const logger = loggerService.withContext('usePinnedEntityIds')

type PinOfType<T extends PinTargetType> = Extract<Pin, { entityType: T }>
type PinEntityIdOf<T extends PinTargetType> = PinOfType<T>['entityId']

export interface UsePinnedEntityIdsResult<T extends PinTargetType> {
  /** Combined UI-loading signal: initial fetch + background refresh + any in-flight mutation. */
  isLoading: boolean
  /** Pinned entity ids for this entityType, in pin-table order (oldest-pinned first). */
  pinnedIds: readonly PinEntityIdOf<T>[]
  /** Force-refresh the pin list (e.g. on popover open). */
  refetch: () => void
  /** Toggle pin state for a given entity id. Idempotent; errors are caught and logged. */
  togglePin: (entityId: PinEntityIdOf<T>) => Promise<void>
}

export function usePinnedEntityIds<T extends PinTargetType>(entityType: T): UsePinnedEntityIdsResult<T> {
  const {
    data: rawPins = [],
    isLoading: isPinsLoading,
    isRefreshing: isPinsRefreshing,
    refetch
  } = useQuery('/pins', { query: { entityType } })

  const { trigger: createPin, isLoading: isCreatingPin } = useMutation('POST', '/pins', {
    refresh: ['/pins']
  })
  const { trigger: deletePin, isLoading: isDeletingPin } = useMutation('DELETE', '/pins/:id', {
    refresh: ['/pins']
  })
  const toggleInFlightRef = useRef(false)

  const pins = useMemo(
    () => rawPins.filter((pin): pin is PinOfType<T> => pin.entityType === entityType),
    [rawPins, entityType]
  )

  const pinByEntityId = useMemo(() => {
    const map = new Map<PinEntityIdOf<T>, PinOfType<T>>()
    for (const pin of pins) {
      map.set(pin.entityId as PinEntityIdOf<T>, pin)
    }
    return map
  }, [pins])

  const pinnedIds = useMemo(() => pins.map((pin) => pin.entityId as PinEntityIdOf<T>), [pins])

  // UI loading signal (includes background refresh).
  const isLoading = isPinsLoading || isPinsRefreshing || isCreatingPin || isDeletingPin

  const togglePin = useCallback(
    async (entityId: PinEntityIdOf<T>) => {
      // Gate on any state that means "snapshot may be stale or a write is
      // already in flight". `isPinsRefreshing` is intentionally included: a
      // revalidation may be importing another window's pin/unpin, and acting
      // on the pre-revalidation `pinByEntityId` snapshot could produce a
      // DELETE with a now-stale pin id (404). Rapid-click UX is already
      // covered by the write flags + `toggleInFlightRef`; the post-mutation
      // refresh window is too short to matter for single-user flows.
      if (isPinsLoading || isPinsRefreshing || isCreatingPin || isDeletingPin || toggleInFlightRef.current) {
        return
      }

      toggleInFlightRef.current = true
      const existing = pinByEntityId.get(entityId)
      try {
        if (existing) {
          await deletePin({ params: { id: existing.id } })
          return
        }

        await createPin({ body: { entityType, entityId } as CreatePinDto })
      } catch (error) {
        logger.error('Failed to toggle pin', error as Error, {
          entityType,
          entityId,
          action: existing ? 'unpin' : 'pin'
        })
      } finally {
        toggleInFlightRef.current = false
      }
    },
    [createPin, deletePin, entityType, isCreatingPin, isDeletingPin, isPinsLoading, isPinsRefreshing, pinByEntityId]
  )

  return {
    isLoading,
    pinnedIds,
    refetch,
    togglePin
  }
}
