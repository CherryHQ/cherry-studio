import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { cacheService } from '@data/CacheService'
import { useDataChange, useMutation, useQuery } from '@data/hooks/useDataApi'
import { toast } from '@renderer/services/toast'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { ClaimHeadFollowupQueueResult } from '@shared/data/api/schemas/followupQueues'
import { FOLLOWUP_QUEUE_LIMIT, type FollowupQueueItem as FollowupQueueRow } from '@shared/data/types/followupQueue'

import type { ComposerSerializedDraft } from './tokens'

export interface FollowupQueueItem {
  id: string
  /** Serialized draft (text + tokens) — drives the dock preview and edit-restore. */
  draft: ComposerSerializedDraft
  /** Send-ready payload (text + parts + files/models) captured at enqueue time. */
  payload: ComposerQueuedMessagePayload
  /** Drain status driving cross-window send arbitration. */
  status: FollowupQueueRow['status']
  /** Last update timestamp (ISO string) — bounds the live-claim freshness check. */
  updatedAt: string
}

// A resolve write that fails with NOT_FOUND needs no retry: the row is
// already gone, so the dequeue already took effect.
function isAlreadyResolved(error: unknown): boolean {
  return error instanceof DataApiError && error.code === ErrorCode.NOT_FOUND
}

// Crash-recovery journal: ids this profile already sent. Written after a
// successful send and checked on every claim win, so a row reclaimed after a
// crash between send and dequeue is dequeued without replaying. Entries are
// cleared when their row resolves; orphans (row deleted elsewhere) are inert
// because ids are never reused. All helpers fail open: the journal is
// hardening, and a broken persist layer must never break draining itself.
function markQueueIdSent(id: string): void {
  try {
    cacheService.setPersist('followup.sent_ids', (prev) => ({ ...prev, [id]: Date.now() }))
  } catch {
    // Journal unavailable — the reclaim lease still bounds replays.
  }
}

function wasQueueIdSent(id: string): boolean {
  try {
    return cacheService.getPersist('followup.sent_ids')[id] !== undefined
  } catch {
    return false
  }
}

function clearSentQueueId(id: string): void {
  try {
    cacheService.setPersist('followup.sent_ids', (prev) => {
      if (prev[id] === undefined) return prev
      const next: Record<string, number> = {}
      for (const key of Object.keys(prev)) {
        if (key !== id) next[key] = prev[key]
      }
      return next
    })
  } catch {
    // Best effort; a stale entry merely skips one future resend check.
  }
}

// Main stores draft/payload as opaque JSON and never interprets them; only the
// renderer reads tokens back, so the row is narrowed at this single boundary.
function toControllerItem(row: FollowupQueueRow): FollowupQueueItem {
  return {
    id: row.id,
    draft: row.draft as ComposerSerializedDraft,
    payload: row.payload,
    status: row.status,
    updatedAt: row.updatedAt
  }
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
  /**
   * Atomic take for edit: claims the item before deleting it, so the take
   * arbitrates with in-flight drains instead of racing them. Resolves the
   * item, or undefined (with a toast on transport failure) when the item is
   * missing or owned by another window's send.
   */
  takeForEdit: (id: string) => Promise<FollowupQueueItem | undefined>
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

  const {
    data: rows,
    isLoading: queuesLoading,
    isRefreshing: queuesRefreshing,
    error: queuesError,
    refetch
  } = useQuery('/followup-queues', { query: { scopeKey } })
  const {
    data: queueState,
    isLoading: stateLoading,
    isRefreshing: stateRefreshing,
    error: stateError,
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
  const { trigger: claimHeadTrigger } = useMutation('POST', '/followup-queues/claim:head')
  const { trigger: markFailedTrigger } = useMutation('POST', '/followup-queues/:id/fail', {
    refresh: ['/followup-queues']
  })
  const { trigger: setPausedTrigger } = useMutation('PUT', '/followup-queue-states', {
    refresh: ['/followup-queue-states']
  })

  // The query layer holds arbitrary JSON; guard non-array entries like the old cache loader did.
  // Rows are filtered to the current scope: while a scope switch refetches,
  // the mirror must not expose (or drain) the previous scope's items.
  const items = useMemo(
    () => (Array.isArray(rows) ? rows : []).filter((row) => row.scopeKey === scopeKey).map(toControllerItem),
    [rows, scopeKey]
  )
  const paused = queueState?.scopeKey === scopeKey ? (queueState?.paused ?? false) : false
  // Fail closed on the pause flag: while the pause-state read is unloaded,
  // scoped elsewhere, or errored, the drain stays parked instead of sending
  // into a possibly-paused conversation.
  const pauseKnown = queueState?.scopeKey === scopeKey && !stateError
  // The drain must wait for settled reads: firing on the completion edge
  // against an unloaded mirror would ack the turn while seeing an empty
  // queue, firing mid-revalidation could send a stale head or ignore a
  // just-toggled pause, and firing on a terminally errored queue read could
  // drain rows the server no longer returns.
  const queriesReady = !queuesLoading && !queuesRefreshing && !stateLoading && !stateRefreshing && !queuesError
  // Background retries re-check this: gates that close after scheduling must
  // park the retry instead of bypassing them.
  const drainBlockedRef = useRef(false)
  drainBlockedRef.current = paused || !queriesReady || !pauseKnown
  // Re-fire the drain when the head arrives after the edge: queue data landing
  // late must not strand an unacknowledged completion.
  const headId = items[0]?.id

  // Latest values for the async drain closure (kept off the effect deps to avoid re-running).
  const scopeKeyRef = useRef(scopeKey)
  scopeKeyRef.current = scopeKey
  const itemsRef = useRef(items)
  itemsRef.current = items
  const onDrainRef = useRef(onDrain)
  onDrainRef.current = onDrain
  const onDrainFailedRef = useRef(onDrainFailed)
  onDrainFailedRef.current = onDrainFailed
  const markSeenRef = useRef(markSeen)
  markSeenRef.current = markSeen
  const isFulfilledRef = useRef(isFulfilled)
  isFulfilledRef.current = isFulfilled
  const mountedRef = useRef(true)
  // Ids with a claim held by this window (drain or steer in flight).
  const activeIdsRef = useRef(new Set<string>())
  // At most one drain cycle runs per scope: a head change (e.g. a concurrent
  // reorder landing mid-claim) re-fires the effect, and without this guard the
  // second cycle could claim and send another row on the same edge. Scoped
  // (not global) so switching conversations while a drain is in flight does
  // not strand the new scope: each scope drains on its own edge.
  const drainBusyScopesRef = useRef(new Set<string>())
  // Background resolve retries that outlive the drain that scheduled them.
  const pendingResolveRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // Background claim retries, unlike resolve retries, belong to the live edge:
  // they stop when the hook unmounts.
  const pendingClaimRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  // Track mount state for background timers. Resolve retries intentionally
  // survive unmount (a sent row must still be dequeued); claim retries stop.
  useEffect(() => {
    mountedRef.current = true
    const pendingClaim = pendingClaimRef.current
    return () => {
      mountedRef.current = false
      for (const timer of pendingClaim.values()) clearTimeout(timer)
      pendingClaim.clear()
    }
  }, [])

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

  const removeId = useCallback(
    (id: string) => {
      // Claim before deleting so the remove arbitrates with in-flight sends:
      // a lost claim means another window owns (and is sending) the item, so
      // deleting would race its send. Crash orphans are reclaimable, so they
      // stay removable.
      void (async () => {
        const claim = await claimItem(id)
        if (!claim) {
          toast.error(t('message.error.operation_unavailable'))
          return
        }
        if (!claim.claimed) {
          toast.error(t('message.error.operation_unavailable'))
          return
        }
        try {
          await removeTrigger({ params: { id } })
          clearSentQueueId(id)
        } catch {
          toast.error(t('message.error.operation_unavailable'))
          // Release the won claim so the item returns to the queue instead of
          // sitting `sending` until the reclaim lease expires.
          try {
            await markFailedTrigger({ params: { id } })
          } catch {
            // Crash-orphan path: the reclaim lease still bounds the stall.
          }
        }
      })()
    },
    [claimItem, removeTrigger, markFailedTrigger, t]
  )

  const takeForEdit = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((entry) => entry.id === id)
      if (!item) return undefined
      const scope = scopeKeyRef.current
      // Claim before deleting so the take arbitrates with in-flight drains:
      // a lost claim means another window owns (and is sending) the item.
      const claim = await claimItem(id)
      if (!claim) {
        toast.error(t('message.error.operation_unavailable'))
        return undefined
      }
      if (!claim.claimed) return undefined
      // Scope switched mid-flight: release the claim instead of restoring a
      // stale-scope draft into the new composer.
      if (scopeKeyRef.current !== scope) {
        try {
          await markFailedTrigger({ params: { id } })
        } catch {
          // Crash-orphan path: the reclaim lease still bounds the stall.
        }
        return undefined
      }
      try {
        await removeTrigger({ params: { id } })
        clearSentQueueId(id)
        return item
      } catch {
        toast.error(t('message.error.operation_unavailable'))
        // Release the won claim so the item returns to the queue instead of
        // sitting `sending` until the reclaim lease expires.
        try {
          await markFailedTrigger({ params: { id } })
        } catch {
          // Crash-orphan path: the reclaim lease still bounds the stall.
        }
        return undefined
      }
    },
    [claimItem, removeTrigger, markFailedTrigger, t]
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

  // Background resolve that never gives up while the row is unsettled:
  // after the inline attempts fail, the row would otherwise sit `sending`
  // until the reclaim lease expires and a later claim replays an already-sent
  // message. Retries run on a timer with no attempt cap — a permanently
  // failing write means the data layer is down, and each tick is a single
  // statement — and refetch on success so mirrors converge; they survive
  // unmount because a sent row must still be dequeued when its composer
  // is gone.
  const scheduleResolveRetryRef = useRef<(id: string, sent: boolean) => void>(() => {})
  scheduleResolveRetryRef.current = (id: string, sent: boolean) => {
    if (pendingResolveRef.current.has(id)) return
    const tick = () => {
      // Release the slot before attempting: the chained schedule on failure
      // would otherwise see the pending entry and stop the chain after one
      // background attempt.
      pendingResolveRef.current.delete(id)
      void (async () => {
        try {
          if (sent) await removeTrigger({ params: { id } })
          else await markFailedTrigger({ params: { id } })
          if (sent) clearSentQueueId(id)
          if (mountedRef.current) void refetch()
        } catch (error) {
          if (isAlreadyResolved(error)) {
            if (mountedRef.current) void refetch()
            return
          }
          scheduleResolveRetryRef.current(id, sent)
        }
      })()
    }
    pendingResolveRef.current.set(id, setTimeout(tick, 5000))
  }

  // Resolve a won claim: dequeue on success, mark failed otherwise. Retried so
  // a successful send is not replayed after a lost dequeue write.
  const settleItem = useCallback(
    async (id: string, sent: boolean) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (sent) await removeTrigger({ params: { id } })
          else await markFailedTrigger({ params: { id } })
          if (sent) clearSentQueueId(id)
          return true
        } catch (error) {
          // The row is already gone: resolving a deletion against it would
          // retry a terminal outcome forever.
          if (isAlreadyResolved(error)) return true
          // Transient IPC/DB failure — retry before giving up.
        }
      }
      scheduleResolveRetryRef.current(id, sent)
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
      if (!item || activeIdsRef.current.has(id)) return false
      const scope = scopeKeyRef.current
      activeIdsRef.current.add(id)
      try {
        const claim = await claimItem(id)
        if (!claim) {
          toast.error(t('message.error.operation_unavailable'))
          return false
        }
        if (!claim.claimed) return false
        // Scope switched mid-flight: release the claim without sending — the
        // payload belongs to the previous scope's conversation. This runs only
        // on our own won claim: a lost claim returns above, so scope cleanup
        // can never release another window's active send.
        if (scopeKeyRef.current !== scope) {
          await settleItem(id, false)
          return false
        }
        if (wasQueueIdSent(id)) {
          // Crash recovery: already sent before dying — dequeue silently.
          await settleItem(id, true)
          return true
        }
        let sent = false
        try {
          sent = await send(item.payload)
        } catch {
          sent = false
        }
        if (sent) markQueueIdSent(id)
        const settled = await settleItem(id, sent)
        if (!settled && sent) {
          toast.error(t('message.error.operation_unavailable'))
        }
        return sent
      } finally {
        activeIdsRef.current.delete(id)
      }
    },
    [claimItem, settleItem, t]
  )

  // Background claim retry while the completion edge stays unacked: a claim
  // request that keeps failing must not strand the queued head until the next
  // turn. Each retry re-reads the current head; the attempt that wins the
  // claim drains immediately. Unbounded by count but self-terminating: ticks
  // stop when the hook unmounts, the edge is acked, or the head is gone.
  const scheduleClaimRetryRef = useRef<(id: string) => void>(() => {})
  scheduleClaimRetryRef.current = (id: string) => {
    if (!mountedRef.current || pendingClaimRef.current.has(id)) return
    const tick = () => {
      pendingClaimRef.current.delete(id)
      if (!mountedRef.current) return
      const head = itemsRef.current.find((entry) => entry.id === id)
      // Gates that closed since scheduling park the retry instead of
      // bypassing them — the effect re-fires the drain when they reopen.
      if (!isFulfilledRef.current || drainBlockedRef.current || !head) return
      void drainHeadRef.current(head)
    }
    pendingClaimRef.current.set(id, setTimeout(tick, 5000))
  }

  // One drain attempt for the given head: claim, ack, send, resolve. Shared by
  // the completion-edge effect and the background claim retry. The mirrored
  // head is only the trigger — ownership comes from the atomic oldest-row
  // claim, so a concurrent reorder cannot slip a different head in between.
  const drainHeadRef = useRef<(head: FollowupQueueItem) => Promise<void>>(() => Promise.resolve())
  drainHeadRef.current = async (head: FollowupQueueItem) => {
    const scope = scopeKeyRef.current
    if (drainBusyScopesRef.current.has(scope) || activeIdsRef.current.has(head.id)) return
    drainBusyScopesRef.current.add(scope)
    activeIdsRef.current.add(head.id)
    try {
      let won: ClaimHeadFollowupQueueResult | undefined
      for (let attempt = 0; attempt < 2 && !won; attempt++) {
        try {
          won = await claimHeadTrigger({ body: { scopeKey: scope } })
        } catch {
          // Transient IPC/DB failure — retry once.
        }
      }
      if (!won) {
        onDrainFailedRef.current?.()
        void refetch()
        scheduleClaimRetryRef.current(head.id)
        return
      }
      if (!won.claimed) {
        // Nothing claimable: ack only when the scope hasn't moved and the
        // mirror still shows queue data (another window owns the head and our
        // mirror converges through its notification). A lost claim from an old
        // scope must never ack the newly selected scope's edge — otherwise the
        // new scope's queued head would wait for the next completion.
        if (scopeKeyRef.current === scope && itemsRef.current[0]) markSeenRef.current()
        return
      }
      const target = itemsRef.current.find((entry) => entry.id === won.id)
      if (!target) {
        // Won the true head but the mirror hasn't caught up: release it back
        // to failed (immediately reclaimable) and preserve the edge — the
        // resolve notification re-fires this cycle with fresh data.
        await settleItem(won.id, false)
        onDrainFailedRef.current?.()
        void refetch()
        return
      }
      // Scope switched mid-flight: release the claim without sending or
      // acking — the head belongs to the previous scope's conversation.
      if (scopeKeyRef.current !== scope) {
        await settleItem(won.id, false)
        return
      }
      if (wasQueueIdSent(won.id)) {
        // Crash recovery: this profile already sent this row before dying, so
        // dequeue without replaying. The edge is acked — the queue made progress.
        await settleItem(won.id, true)
        markSeenRef.current()
        return
      }
      markSeenRef.current()
      let sent = false
      try {
        sent = await onDrainRef.current(target.payload)
      } catch {
        sent = false
      }
      // Record the send before resolving: a crash after this point replays as
      // a skip (via the check above), never as a second send.
      if (sent) markQueueIdSent(won.id)
      const settled = await settleItem(won.id, sent)
      if (!settled && sent) {
        toast.error(t('message.error.operation_unavailable'))
      }
      if (!sent) onDrainFailedRef.current?.()
    } finally {
      drainBusyScopesRef.current.delete(scope)
      activeIdsRef.current.delete(head.id)
    }
  }

  // Drain one message per completion: on the live→idle edge, claim the head
  // (only the winning window sends) and resolve the claim — dequeue on
  // success, mark failed otherwise. The edge is acked only once the claim
  // settles: a lost claim means another window is sending (our mirror
  // converges through the change notification), while a failed claim request
  // leaves the edge for a later turn and schedules a background retry.
  // Resolution writes are retried so a successful send is not replayed after
  // a lost dequeue.
  useEffect(() => {
    if (!isFulfilled || paused || !queriesReady || !pauseKnown) return
    const head = itemsRef.current[0]
    if (!head || head.id !== headId) return
    void drainHeadRef.current(head)
  }, [isFulfilled, paused, queriesReady, pauseKnown, headId, scopeKey])

  return { items, enqueue, removeId, reorder, paused, setPaused, steer, takeForEdit }
}
