/**
 * Generic hook for reading and toggling pins of a given entity type.
 *
 * DataApi does not auto-sync across windows, so consumers should call
 * `refetch` when opening a pin-aware surface that needs fresh state.
 */

import type { DataApiRefreshTarget } from '@data/hooks/useDataApi'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { EntityType } from '@shared/data/types/entityType'
import { useCallback, useEffect, useMemo, useRef } from 'react'

const logger = loggerService.withContext('usePins')

/**
 * Refresh targets for pin writes, keyed by entity type — the single owner of
 * this knowledge; do not declare `/pins` mutations with hand-rolled `refresh`
 * lists elsewhere.
 *
 * Topic and session lists expose independent pinned and ordinary cursor
 * streams, so pin-state changes move a row between `/topics` /
 * `/agent-sessions` query families: both cursor chains must be reset and their
 * stats refreshed, not just `/pins` membership. Other entity types group
 * pinned rows client-side, so refreshing `/pins` alone is enough.
 */
function pinRefreshTargets(entityType: EntityType): DataApiRefreshTarget[] {
  switch (entityType) {
    case 'topic':
      return ['/pins', { path: '/topics', strategy: 'reset-cursor' }, '/topics/stats']
    case 'session':
      return ['/pins', { path: '/agent-sessions', strategy: 'reset-cursor' }, '/agent-sessions/stats']
    default:
      return ['/pins']
  }
}

export interface UsePinMutationsResult {
  /** Any in-flight pin/unpin write. */
  isMutating: boolean
  /** Most recent pin/unpin write error, if any. */
  error: Error | undefined
  /** Pin the given entity. Rejects on write errors. */
  pin: (entityId: string) => Promise<unknown>
  /** Remove a pin by its pin row id. Rejects on write errors. */
  unpin: (pinId: string) => Promise<unknown>
}

/**
 * Pin/unpin write triggers for surfaces that already project `pinId` onto
 * their rows and don't need the `/pins` read that {@link usePins} performs.
 */
export function usePinMutations(entityType: EntityType): UsePinMutationsResult {
  const refresh = useMemo(() => pinRefreshTargets(entityType), [entityType])
  const { trigger: createPin, isLoading: isPinning, error: pinError } = useMutation('POST', '/pins', { refresh })
  const {
    trigger: deletePin,
    isLoading: isUnpinning,
    error: unpinError
  } = useMutation('DELETE', '/pins/:id', { refresh })

  const pin = useCallback((entityId: string) => createPin({ body: { entityType, entityId } }), [createPin, entityType])
  const unpin = useCallback((pinId: string) => deletePin({ params: { id: pinId } }), [deletePin])

  return { pin, unpin, isMutating: isPinning || isUnpinning, error: pinError ?? unpinError }
}

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
  refetch: () => Promise<unknown>
  /** Toggle pin state for a given entity id. Gated no-ops resolve (logged at debug); real write errors reject. */
  togglePin: (entityId: string) => Promise<void>
}

export interface UsePinsOptions {
  enabled?: boolean
}

export function usePins(entityType: EntityType, options: UsePinsOptions = {}): UsePinsResult {
  const enabled = options.enabled ?? true
  const {
    data: rawPins = [],
    isLoading,
    isRefreshing,
    error: queryError,
    refetch
  } = useQuery('/pins', { enabled, query: { entityType } })

  const { pin: createPin, unpin: deletePin, isMutating, error: mutationError } = usePinMutations(entityType)
  const toggleInFlightRef = useRef(false)

  const pins = useMemo(
    () => (enabled ? rawPins.filter((pin) => pin.entityType === entityType) : []),
    [enabled, rawPins, entityType]
  )
  const pinnedIds = useMemo(() => pins.map((pin) => pin.entityId), [pins])
  const error = queryError ?? mutationError

  useEffect(() => {
    if (enabled && queryError) {
      logger.error('Failed to read pins', queryError, { entityType })
    }
  }, [enabled, queryError, entityType])

  const stateRef = useRef({ enabled, isLoading, isRefreshing, isMutating })
  const pinsRef = useRef(pins)
  stateRef.current = { enabled, isLoading, isRefreshing, isMutating }
  pinsRef.current = pins

  const togglePin = useCallback(
    async (entityId: string) => {
      const state = stateRef.current
      if (!state.enabled || state.isLoading || state.isRefreshing || state.isMutating || toggleInFlightRef.current) {
        logger.debug('togglePin gated', {
          entityType,
          entityId,
          enabled: state.enabled,
          isLoading: state.isLoading,
          isRefreshing: state.isRefreshing,
          isMutating: state.isMutating,
          inFlight: toggleInFlightRef.current
        })
        return
      }

      toggleInFlightRef.current = true
      try {
        const existing = pinsRef.current.find((pin) => pin.entityId === entityId)
        if (existing) {
          await deletePin(existing.id)
          return
        }

        await createPin(entityId)
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
