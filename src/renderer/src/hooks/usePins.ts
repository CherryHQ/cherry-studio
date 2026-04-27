/**
 * Generic hook for reading and toggling pins of a given entity type.
 *
 * DataApi does not auto-sync across windows, so consumers should call
 * `refetch` when opening a pin-aware surface that needs fresh state.
 */

import { useMutation, useQuery } from '@data/hooks/useDataApi'
import type { EntityType } from '@shared/data/types/entityType'
import { useCallback, useMemo, useRef } from 'react'

export interface UsePinsResult {
  /** Initial pin list load only. */
  isLoading: boolean
  /** Background revalidation state. */
  isRefreshing: boolean
  /** Any in-flight pin/unpin write. */
  isMutating: boolean
  /** Most recent read/write error, if any. */
  error: Error | undefined
  /** Pinned entity ids for this entityType, in API order. */
  pinnedIds: readonly string[]
  /** Force-refresh the pin list. */
  refetch: () => void
  /** Toggle pin state for a given entity id. Gated no-ops resolve; real write errors reject. */
  togglePin: (entityId: string) => Promise<void>
}

export function usePins(entityType: EntityType): UsePinsResult {
  const {
    data: rawPins = [],
    isLoading,
    isRefreshing,
    error: queryError,
    refetch
  } = useQuery('/pins', { query: { entityType } })

  const {
    trigger: createPin,
    isLoading: isCreatingPin,
    error: createError
  } = useMutation('POST', '/pins', {
    refresh: ['/pins']
  })
  const {
    trigger: deletePin,
    isLoading: isDeletingPin,
    error: deleteError
  } = useMutation('DELETE', '/pins/:id', {
    refresh: ['/pins']
  })
  const toggleInFlightRef = useRef(false)

  const pins = useMemo(() => rawPins.filter((pin) => pin.entityType === entityType), [rawPins, entityType])
  const pinnedIds = useMemo(() => pins.map((pin) => pin.entityId), [pins])
  const isMutating = isCreatingPin || isDeletingPin
  const error = queryError ?? createError ?? deleteError

  const stateRef = useRef({ isLoading, isRefreshing, isMutating })
  const pinsRef = useRef(pins)
  stateRef.current = { isLoading, isRefreshing, isMutating }
  pinsRef.current = pins

  const togglePin = useCallback(
    async (entityId: string) => {
      const state = stateRef.current
      if (state.isLoading || state.isRefreshing || state.isMutating || toggleInFlightRef.current) {
        return
      }

      toggleInFlightRef.current = true
      try {
        const existing = pinsRef.current.find((pin) => pin.entityId === entityId)
        if (existing) {
          await deletePin({ params: { id: existing.id } })
          return
        }

        await createPin({ body: { entityType, entityId } })
      } finally {
        toggleInFlightRef.current = false
      }
    },
    [createPin, deletePin, entityType]
  )

  return {
    isLoading,
    isRefreshing,
    isMutating,
    error,
    pinnedIds,
    refetch,
    togglePin
  }
}
