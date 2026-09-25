import { useCallback, useRef } from 'react'

import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'

import type { FollowupQueueItem } from '../../useFollowupQueue'
import { useLatest } from './useLatest'

interface SteerQueuedFollowupDeps {
  /** Live queue items; the steered entry is looked up at click time. */
  items: FollowupQueueItem[]
  /** Claim the queue's shared send slot; false means another send is in flight. */
  tryClaimSend: (id: string) => boolean
  /** Release a claim taken by `tryClaimSend`. */
  releaseSend: (id: string) => void
  /** Dequeue after a successful send. */
  removeFollowup: (id: string) => void
  /** Variant-specific send (chat / agent); resolves to whether it was sent. */
  sendPayload: (payload: ComposerQueuedMessagePayload) => Promise<boolean>
}

/**
 * Manual steer for one queued follow-up: guards re-entrant clicks, claims the
 * queue's shared send slot so a concurrent auto-drain cannot submit the same
 * payload twice, and only drops the item once the send actually succeeds.
 */
export function useSteerQueuedFollowup(deps: SteerQueuedFollowupDeps): (id: string) => Promise<void> {
  const steeringIdsRef = useRef<Set<string>>(new Set())
  const latestRef = useLatest(deps)
  return useCallback(
    async (id: string) => {
      if (steeringIdsRef.current.has(id)) return
      const { items, tryClaimSend, releaseSend, removeFollowup, sendPayload } = latestRef.current
      const item = items.find((entry) => entry.id === id)
      if (!item) return
      if (!tryClaimSend(id)) return
      steeringIdsRef.current.add(id)
      try {
        const sent = await sendPayload(item.payload)
        if (sent) removeFollowup(id)
      } finally {
        releaseSend(id)
        steeringIdsRef.current.delete(id)
      }
    },
    [latestRef]
  )
}
