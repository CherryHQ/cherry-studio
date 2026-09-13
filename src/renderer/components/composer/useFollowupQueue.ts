import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useDataChange, useMutation, useQuery } from '@data/hooks/useDataApi'
import { toast } from '@renderer/services/toast'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import { FOLLOWUP_QUEUE_LIMIT, type FollowupQueueItem as FollowupQueueRow } from '@shared/data/types/followupQueue'

import type { ComposerSerializedDraft } from './tokens'

export interface FollowupQueueItem {
  id: string
  /** Serialized draft (text + tokens) — drives the dock preview and edit-restore. */
  draft: ComposerSerializedDraft
  /** Send-ready payload (text + parts + files/models) captured at enqueue time. */
  payload: ComposerQueuedMessagePayload
}

// Main stores draft/payload as opaque JSON and never interprets them; only the
// renderer reads tokens back, so the row is narrowed at this single boundary.
function toControllerItem(row: FollowupQueueRow): FollowupQueueItem {
  return { id: row.id, draft: row.draft as ComposerSerializedDraft, payload: row.payload }
}

interface UseFollowupQueueParams {
  /** Per-conversation key — same `${topicId}:${assistantId}` scope as the draft cache. */
  scopeKey: string
  /** `done`-and-unacknowledged edge from `useTopicStreamStatus` — the live→idle drain trigger. */
  isFulfilled: boolean
  /** Acknowledge the completion so the drain fires once per turn. */
  markSeen: () => void
  /** Send a payload (busy → backend steer; idle → normal send). Resolves to whether it was sent. */
  onDrain: (payload: ComposerQueuedMessagePayload) => Promise<boolean>
  /** Called when auto-drain fails and leaves the queued item in place. */
  onDrainFailed?: () => void
}

export interface FollowupQueueController {
  items: FollowupQueueItem[]
  enqueue: (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => Promise<boolean>
  removeId: (id: string) => void
  reorder: (nextItems: FollowupQueueItem[]) => void
  paused: boolean
  setPaused: (paused: boolean) => void
  /**
   * Manual steer through the same claim arbitration as auto-drain. Resolves
   * true when the send succeeded (item dequeued), false otherwise — a lost
   * claim means another window owns the item.
   */
  steer: (id: string, send: (payload: ComposerQueuedMessagePayload) => Promise<boolean>) => Promise<boolean>
}

/**
 * Per-conversation FIFO queue of follow-up drafts, durable across restarts.
 * While a turn streams the composer enqueues here instead of sending; on the
 * live→idle edge the head auto-drains (one per completion) through a
 * cross-window claim — only the window whose claim wins sends — and the dock
 * lets the user steer/edit/remove individual items or pause auto-drain.
 */
export function useFollowupQueue({
  scopeKey,
  isFulfilled,
  markSeen,
  onDrain,
  onDrainFailed
}: UseFollowupQueueParams): FollowupQueueController {
  const { t } = useTranslation()

  const { data: rows, isLoading: queuesLoading, refetch } = useQuery('/followup-queues', { query: { scopeKey } })
  const {
    data: queueState,
    isLoading: stateLoading,
    refetch: refetchState
  } = useQuery('/followup-queue-states', {
    query: { scopeKey }
  })
  useDataChange('/followup-queues', () => {
    void refetch()
  })
  useDataChange('/followup-queue-states', () => {
    void refetchState()
  })

  const { trigger: enqueueTrigger } = useMutation('POST', '/followup-queues', {
    refresh: ['/followup-queues']
  })
  const { trigger: removeTrigger } = useMutation('DELETE', '/followup-queues/:id', {
    refresh: ['/followup-queues']
  })
  const { trigger: reorderTrigger } = useMutation('PATCH', '/followup-queues/order:batch', {
    refresh: ['/followup-queues']
  })
  const { trigger: claimTrigger } = useMutation('POST', '/followup-queues/:id/claim')
  const { trigger: markFailedTrigger } = useMutation('POST', '/followup-queues/:id/fail', {
    refresh: ['/followup-queues']
  })
  const { trigger: setPausedTrigger } = useMutation('PUT', '/followup-queue-states', {
    refresh: ['/followup-queue-states']
  })

  // The query layer holds arbitrary JSON; guard non-array entries like the old cache loader did.
  const items = useMemo(() => (Array.isArray(rows) ? rows : []).map(toControllerItem), [rows])
  const paused = queueState?.paused ?? false
  // The drain must wait for both reads: firing on the completion edge against
  // an unloaded mirror would ack the turn while seeing an empty queue.
  const queriesReady = !queuesLoading && !stateLoading

  // Latest values for the async drain closure (kept off the effect deps to avoid re-running).
  const scopeKeyRef = useRef(scopeKey)
  scopeKeyRef.current = scopeKey
  const itemsRef = useRef(items)
  itemsRef.current = items
  const onDrainRef = useRef(onDrain)
  onDrainRef.current = onDrain
  const onDrainFailedRef = useRef(onDrainFailed)
  onDrainFailedRef.current = onDrainFailed

  const enqueue = useCallback(
    async (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => {
      if (itemsRef.current.length >= FOLLOWUP_QUEUE_LIMIT) {
        toast.error(t('chat.input.followup_queue.limit_reached', { count: FOLLOWUP_QUEUE_LIMIT }))
        return false
      }
      try {
        await enqueueTrigger({ body: { scopeKey: scopeKeyRef.current, draft, payload } })
        return true
      } catch {
        toast.error(t('message.error.operation_unavailable'))
        return false
      }
    },
    [enqueueTrigger, t]
  )

  const removeId = useCallback(
    (id: string) => {
      void removeTrigger({ params: { id } }).catch(() => {
        toast.error(t('message.error.operation_unavailable'))
      })
    },
    [removeTrigger, t]
  )

  const reorder = useCallback(
    (nextItems: FollowupQueueItem[]) => {
      const moves = nextItems.slice(1).map((item, index) => ({ id: item.id, anchor: { after: nextItems[index].id } }))
      if (moves.length === 0) return
      void reorderTrigger({ body: { moves } }).catch(() => {
        toast.error(t('message.error.operation_unavailable'))
      })
    },
    [reorderTrigger, t]
  )

  const setPaused = useCallback(
    (nextPaused: boolean) => {
      void setPausedTrigger({ body: { scopeKey: scopeKeyRef.current, paused: nextPaused } }).catch(() => {
        toast.error(t('message.error.operation_unavailable'))
      })
    },
    [setPausedTrigger, t]
  )

  // Conditional pending/failed → sending transition with one retry. Resolves
  // undefined when the request itself keeps failing (no window owns the item).
  const claimItem = useCallback(
    async (id: string) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await claimTrigger({ params: { id } })
        } catch {
          // Transient IPC/DB failure — retry once.
        }
      }
      return undefined
    },
    [claimTrigger]
  )

  // Resolve a won claim: dequeue on success, mark failed otherwise. Retried so
  // a successful send is not replayed after a lost dequeue write.
  const settleItem = useCallback(
    async (id: string, sent: boolean) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (sent) await removeTrigger({ params: { id } })
          else await markFailedTrigger({ params: { id } })
          return true
        } catch {
          // Transient IPC/DB failure — retry before giving up.
        }
      }
      return false
    },
    [removeTrigger, markFailedTrigger]
  )

  // Manual steer through the same claim arbitration as auto-drain: only the
  // window whose claim wins sends. A lost claim means another window owns the
  // item (our mirror converges through the change notification); a failed
  // send keeps the item queued as failed for the next turn.
  const steer = useCallback(
    async (id: string, send: (payload: ComposerQueuedMessagePayload) => Promise<boolean>) => {
      const item = itemsRef.current.find((entry) => entry.id === id)
      if (!item) return false
      const claim = await claimItem(id)
      if (!claim) {
        toast.error(t('message.error.operation_unavailable'))
        return false
      }
      if (!claim.claimed) return false
      let sent = false
      try {
        sent = await send(item.payload)
      } catch {
        sent = false
      }
      const settled = await settleItem(id, sent)
      if (!settled && sent) {
        toast.error(t('message.error.operation_unavailable'))
      }
      return sent
    },
    [claimItem, settleItem, t]
  )

  // Drain one message per completion: on the live→idle edge, claim the head
  // (only the winning window sends) and resolve the claim — dequeue on
  // success, mark failed otherwise. The edge is acked only once the claim
  // settles: a lost claim means another window is sending (our mirror
  // converges through the change notification), while a failed claim request
  // leaves the edge for a later turn. Resolution writes are retried so a
  // successful send is not replayed after a lost dequeue.
  useEffect(() => {
    if (!isFulfilled || paused || !queriesReady) return
    const head = itemsRef.current[0]
    if (!head) return
    const reportDrainFailure = () => onDrainFailedRef.current?.()
    void (async () => {
      const claim = await claimItem(head.id)
      if (!claim) {
        reportDrainFailure()
        void refetch()
        return
      }
      markSeen()
      if (!claim.claimed) return
      let sent = false
      try {
        sent = await onDrainRef.current(head.payload)
      } catch {
        sent = false
      }
      const settled = await settleItem(head.id, sent)
      if (!settled && sent) {
        toast.error(t('message.error.operation_unavailable'))
      }
      if (!sent) reportDrainFailure()
    })()
  }, [isFulfilled, paused, queriesReady, markSeen, claimItem, settleItem, refetch, t])

  return { items, enqueue, removeId, reorder, paused, setPaused, steer }
}
