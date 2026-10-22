import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cacheService } from '@data/CacheService'
import { useDataChange, useMutation, useQuery } from '@data/hooks/useDataApi'
import { toast } from '@renderer/services/toast'
import type { ComposerQueuedMessagePayload, TopicStreamStatus } from '@shared/ai/transport'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { ClaimHeadFollowupQueueResult } from '@shared/data/api/schemas/followupQueues'
import {
  FOLLOWUP_QUEUE_HEARTBEAT_MS,
  FOLLOWUP_QUEUE_LIMIT,
  FOLLOWUP_QUEUE_SEND_TIMEOUT_MS,
  type FollowupQueueItem as FollowupQueueRow
} from '@shared/data/types/followupQueue'

import type { ComposerSerializedDraft } from './tokens'

/**
 * Queued payloads are persisted as JSON over IPC, where a pathless `Blob` (e.g. a screenshot) would
 * serialize to `{}` and lose its bytes. Write such bytes to a managed file first and keep only its
 * durable path, so the send-time part build reads the file instead of a dead Blob.
 */
export async function persistBlobAttachments(
  payload: ComposerQueuedMessagePayload
): Promise<ComposerQueuedMessagePayload> {
  const attachments = payload.attachments
  if (!attachments?.some((attachment) => attachment.blob instanceof Blob)) return payload
  const persisted = await Promise.all(
    attachments.map(async (attachment) => {
      const blob = attachment.blob
      if (!(blob instanceof Blob)) return attachment
      const name = String(attachment.origin_name || attachment.name || 'attachment')
      const ext = typeof attachment.ext === 'string' ? attachment.ext.replace(/^\./, '') || null : null
      const entry = await window.api.file.createInternalEntry({
        source: 'bytes',
        data: new Uint8Array(await blob.arrayBuffer()),
        name,
        ext,
        cleanupPolicy: 'delete_when_unreferenced'
      })
      const path = await window.api.file.getPhysicalPath({ id: entry.id })
      const rest = { ...attachment }
      delete rest.blob
      // Keep the managed entry id so enqueue can register durable file
      // ownership; without it the idle sweep can delete the bytes mid-queue.
      return { ...rest, path, entryId: entry.id }
    })
  )
  return { ...payload, attachments: persisted }
}

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

type RestoreQueueBody = {
  id: string
  scopeKey: string
  draft: ComposerSerializedDraft
  payload: ComposerQueuedMessagePayload
  fileEntryIds?: string[]
}

// Restoration enqueues (edit handoff, scope/unmount recovery, background
// retry) persist like an ordinary enqueue: fresh Blobs become durable files
// and the row records fileEntryIds, otherwise restored attachments serialize
// as {} and managed attachments become cleanup-eligible once the original
// row's references close (cherry-pr-review). Already-durable payloads pass
// through unchanged, so a background retry can rebuild the body safely.
async function buildRestoreBody(
  id: string,
  scopeKey: string,
  draft: ComposerSerializedDraft,
  payload: ComposerQueuedMessagePayload
): Promise<RestoreQueueBody> {
  const durablePayload = await persistBlobAttachments(payload)
  const fileEntryIds = (durablePayload.attachments ?? [])
    .map((attachment) => attachment.entryId)
    .filter((id): id is string => typeof id === 'string')
  return { id, scopeKey, draft, payload: durablePayload, ...(fileEntryIds.length > 0 ? { fileEntryIds } : {}) }
}

// A resolve write that fails with NOT_FOUND needs no retry: the row is
// already gone, so the dequeue already took effect.
function isAlreadyResolved(error: unknown): boolean {
  return error instanceof DataApiError && error.code === ErrorCode.NOT_FOUND
}

// Crash recovery rides the row itself: the owner records its successful send
// server-side (`sentAt`) before resolving, so a row reclaimed after a crash
// between send and dequeue is dequeued without replaying. The marker dies
// with its row, so — unlike a client snapshot journal — it can neither leak
// nor lose concurrent cross-window updates.

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

// A send that never settles would hold its heartbeat-renewed claim forever and
// wedge its scope's FIFO. Abandon the wait after a lease-scale bound instead.
interface SendOutcome {
  sent: boolean
  timedOut: boolean
}
async function awaitSendWithTimeout(send: Promise<boolean>): Promise<SendOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<SendOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ sent: false, timedOut: true }), FOLLOWUP_QUEUE_SEND_TIMEOUT_MS)
  })
  try {
    return await Promise.race([send.then((sent) => ({ sent, timedOut: false })), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Cross-window record of the stream completion this scope already drained.
 * The drain trigger is the completion itself (not the conversation list read
 * receipt), so consumption needs its own marker: one completion sends at most
 * one follow-up, even when the turn was already marked read or another window
 * won the send.
 */
// Scope keys may contain ':' (topic scopes), which template keys forbid — encode it.
// Keep the narrow template-literal type: widening to the SharedCacheKey union
// makes getShared infer every cache value type (TS2322 at the lookup).
const consumedKeyFor = (scopeKey: string): `followup_queue.consumed.${string}` =>
  `followup_queue.consumed.${encodeURIComponent(scopeKey)}`
const loadConsumed = (scopeKey: string): number | null => cacheService.getShared(consumedKeyFor(scopeKey)) ?? null

interface UseFollowupQueueParams {
  /** Per-conversation key — same `${topicId}:${assistantId}` scope as the draft cache. */
  scopeKey: string
  /** Stream completion is the drain trigger, independent of the conversation list read receipt. */
  status: TopicStreamStatus | undefined
  /** Timestamp of the last completed turn; a completion drains at most one queued follow-up. */
  lastCompletedAt: number | null
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
   * arbitrates with in-flight drains instead of racing them. When another
   * item is already being edited, captureOutgoing rebuilds its draft +
   * payload from the live editor and it returns to its queue slot first, so
   * the queue stays the single owner of every queued message. Resolves the
   * item, or undefined (with a toast on transport failure) when the item is
   * missing, owned by another window's send, or captureOutgoing refuses the
   * switch by returning null.
   */
  takeForEdit: (
    id: string,
    captureOutgoing: (taken: FollowupQueueItem) => Pick<FollowupQueueItem, 'draft' | 'payload'> | null
  ) => Promise<FollowupQueueItem | undefined>
  /** End the edit session: the composer draft was sent, cleared, or replaced, so the taken item is not returned to the queue. */
  releaseEdit: () => void
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
  status,
  lastCompletedAt,
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
  // Takes delete on a dedicated instance: SWR turns an older trigger's rejection
  // into a resolve once a newer trigger starts on the same instance, hiding failure.
  const { trigger: takeDeleteTrigger } = useMutation('DELETE', '/followup-queues/:id', {
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
  const { trigger: markSentTrigger } = useMutation('POST', '/followup-queues/:id/sent')
  const { trigger: heartbeatTrigger } = useMutation('POST', '/followup-queues/:id/heartbeat')
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
  // Optimistic pause: the PUT + refetch round-trip leaves a window where the
  // server still reports unpaused — a completion edge landing in that window
  // would drain against the user's explicit Pause. Hold the requested value
  // locally until the server echoes it (or the request fails). Scoped, so a
  // conversation switch never inherits another scope's hold.
  const [pausedOverride, setPausedOverride] = useState<{ scopeKey: string; paused: boolean } | null>(null)
  const serverPaused = queueState?.scopeKey === scopeKey ? (queueState?.paused ?? false) : false
  const paused = pausedOverride && pausedOverride.scopeKey === scopeKey ? pausedOverride.paused : serverPaused
  useEffect(() => {
    if (
      pausedOverride &&
      queueState?.scopeKey === pausedOverride.scopeKey &&
      queueState.paused === pausedOverride.paused
    ) {
      setPausedOverride(null)
    }
  }, [pausedOverride, queueState])
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
  // Volatile record of the item taken out for editing plus its insertion
  // slot. Deliberately not persisted and scope-bound: a scope change drops
  // it instead of requeueing anything.
  const takenEditRef = useRef<{ item: FollowupQueueItem; slot: number; scopeKey: string } | null>(null)
  const prevScopeForEditRef = useRef(scopeKey)
  if (prevScopeForEditRef.current !== scopeKey) {
    prevScopeForEditRef.current = scopeKey
    takenEditRef.current = null
  }
  const onDrainRef = useRef(onDrain)
  onDrainRef.current = onDrain
  const onDrainFailedRef = useRef(onDrainFailed)
  onDrainFailedRef.current = onDrainFailed
  const statusRef = useRef(status)
  statusRef.current = status
  const lastCompletedAtRef = useRef(lastCompletedAt)
  lastCompletedAtRef.current = lastCompletedAt
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
  // Ownership heartbeats, one per in-flight owned send. These also outlive the
  // drain that started them: the send promise continues past unmount and must
  // keep its claim fresh until it settles. Stopped by settleItem, the single
  // choke point for every owned-claim resolution.
  const pendingHeartbeatRef = useRef(new Map<string, ReturnType<typeof setInterval>>())
  // Background claim retries, unlike resolve retries, belong to the live edge:
  // they stop when the hook unmounts.
  const pendingClaimRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // Drafts orphaned when a scope switch lands mid-take and the replacement
  // enqueue keeps failing: retried until the write lands, like resolve retries.
  const pendingReenqueueRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // The restore retry scheduled when an edit switch is refused (queue full /
  // persistence down) belongs to the LIVE edit session: the outgoing item is
  // still in the editor. Ending that session (send/clear/replace) must cancel
  // the retry — and remove a copy that already landed — or the item is
  // re-created in the queue and delivered again (cherry-pr-review). One slot:
  // a newer refused switch cancels and replaces the older record.
  type TrackedEditRestore = { restoreId: string; cancelled: boolean; restored: boolean }
  const editRestoreRef = useRef<TrackedEditRestore | null>(null)
  // Single-flight pause writes per scope: rapid Pause/Resume coalesces to the
  // latest request instead of letting concurrent PUTs resolve out of order.
  // Scoped slots, so a pending Resume in one conversation is never overwritten
  // by a Pause in another.
  const pausedInflightRef = useRef(new Set<string>())
  const pausedQueuedRef = useRef(new Map<string, boolean>())

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
        // Idempotency key for the transport retry: a POST that commits
        // server-side but times out is retried with the same body, and the
        // service returns the existing row instead of duplicating it.
        const scopeKey = scopeKeyRef.current
        const durablePayload = await persistBlobAttachments(payload)
        const fileEntryIds = (durablePayload.attachments ?? [])
          .map((attachment) => attachment.entryId)
          .filter((id): id is string => typeof id === 'string')
        await enqueueTrigger({
          body: {
            id: crypto.randomUUID(),
            scopeKey,
            draft,
            payload: durablePayload,
            ...(fileEntryIds.length > 0 ? { fileEntryIds } : {})
          }
        })
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
  // One claim token spans the retries, so a retry after a committed claim whose
  // response was lost re-acquires that claim instead of reporting it lost.
  const claimItem = useCallback(
    async (id: string) => {
      const claimToken = crypto.randomUUID()
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const claim = await claimTrigger({ params: { id }, body: { claimToken } })
          // A resolved-but-empty claim is a failure like a thrown one.
          if (!claim) return undefined
          // Settlements are fenced by the winning token: hand it to every
          // fail/sent/heartbeat this claim later performs.
          return { claim, claimToken }
        } catch {
          // Transient IPC/DB failure — retry once.
        }
      }
      return undefined
    },
    [claimTrigger]
  )

  // Keep the taken item's restore slot aligned as earlier rows leave the
  // queue; removing the taken item's own requeued copy ends the session.
  // `index` is captured by the caller before the removal lands.
  const noteItemRemoved = useCallback((removedId: string, index: number) => {
    const taken = takenEditRef.current
    if (!taken) return
    if (taken.item.id === removedId) {
      takenEditRef.current = null
      return
    }
    if (index >= 0 && index < taken.slot) takenEditRef.current = { ...taken, slot: taken.slot - 1 }
  }, [])

  const removeId = useCallback(
    (id: string) => {
      // Claim before deleting so the remove arbitrates with in-flight sends:
      // a lost claim means another window owns (and is sending) the item, so
      // deleting would race its send. Crash orphans are reclaimable, so they
      // stay removable.
      const removalIndex = itemsRef.current.findIndex((entry) => entry.id === id)
      void (async () => {
        const result = await claimItem(id)
        if (!result) {
          toast.error(t('message.error.operation_unavailable'))
          return
        }
        if (!result.claim.claimed) {
          toast.error(t('message.error.operation_unavailable'))
          return
        }
        try {
          await removeTrigger({ params: { id } })
          noteItemRemoved(id, removalIndex)
        } catch {
          toast.error(t('message.error.operation_unavailable'))
          // Release the won claim so the item returns to the queue instead of
          // sitting `sending` until the reclaim lease expires.
          try {
            await markFailedTrigger({ params: { id }, body: { claimToken: result.claimToken } })
          } catch {
            // Crash-orphan path: the reclaim lease still bounds the stall.
          }
        }
      })()
    },
    [claimItem, removeTrigger, markFailedTrigger, noteItemRemoved, t]
  )

  const takeForEditInner = useCallback(
    async (
      id: string,
      captureOutgoing: (taken: FollowupQueueItem) => Pick<FollowupQueueItem, 'draft' | 'payload'> | null
    ) => {
      // Re-taking the current edit target would restore it into itself.
      if (takenEditRef.current?.item.id === id) return undefined
      const item = itemsRef.current.find((entry) => entry.id === id)
      if (!item) return undefined
      const scope = scopeKeyRef.current
      // Claim before deleting so the take arbitrates with in-flight drains:
      // a lost claim means another window owns (and is sending) the item.
      const result = await claimItem(id)
      if (!result) {
        toast.error(t('message.error.operation_unavailable'))
        return undefined
      }
      const { claim, claimToken } = result
      if (!claim.claimed) return undefined
      const releaseClaim = async () => {
        // Release the won claim so the item returns to the queue instead of
        // sitting `sending` until the reclaim lease expires.
        try {
          await markFailedTrigger({ params: { id }, body: { claimToken } })
        } catch {
          // Crash-orphan path: the reclaim lease still bounds the stall.
        }
      }
      // Unmounted while the claim was in flight: release it without deleting —
      // no composer is left to receive the restored draft. The row stays queued.
      if (!mountedRef.current) {
        await releaseClaim()
        return undefined
      }
      // Scope switched mid-flight: release the claim instead of restoring a
      // stale-scope draft into the new composer.
      if (scopeKeyRef.current !== scope) {
        await releaseClaim()
        return undefined
      }
      // Switching the edit target: return the outgoing item to its slot —
      // rebuilt from the live editor — BEFORE deleting the incoming one, so a
      // crash mid-switch leaves a duplicate in the queue rather than losing
      // the outgoing draft entirely.
      const taken = takenEditRef.current
      let incomingSlot = itemsRef.current.findIndex((entry) => entry.id === id)
      if (taken) {
        let outgoing: Pick<FollowupQueueItem, 'draft' | 'payload'> | null = null
        try {
          outgoing = captureOutgoing(taken.item)
        } catch {
          outgoing = null
        }
        if (!outgoing) {
          // The editor cannot produce a message right now (unsynchronised
          // attachments): refuse the switch and change nothing.
          await releaseClaim()
          return undefined
        }
        let restored = false
        // Fresh insertion identity, stable across the retries: the original
        // row closed when it was taken, so re-enqueueing under its id returns
        // the receipt without storing the edited content (cherry-pr-review).
        const restoreId = crypto.randomUUID()
        let restoreBody: RestoreQueueBody
        try {
          restoreBody = await buildRestoreBody(restoreId, scope, outgoing.draft, outgoing.payload)
        } catch {
          // Attachments cannot be made durable right now: refuse the switch —
          // the outgoing edit is still in the editor, nothing is lost.
          await releaseClaim()
          toast.error(t('message.error.operation_unavailable'))
          return undefined
        }
        for (let attempt = 0; attempt < 3 && !restored; attempt++) {
          try {
            await enqueueTrigger({ body: restoreBody })
            restored = true
          } catch (error) {
            // The conversation was permanently deleted: nothing to restore
            // into. Otherwise transient — retry inline, then in the background.
            if (isAlreadyResolved(error)) break
          }
        }
        if (!restored) {
          await releaseClaim()
          toast.error(t('message.error.operation_unavailable'))
          // Editor-owned retry: the outgoing item stays in the editor, so this
          // restore belongs to the live session — ending the session cancels
          // it (and removes a landed copy) instead of letting the item
          // reappear in the queue after it was sent or cleared.
          cancelTrackedEditRestoreRef.current()
          const tracked = { restoreId: restoreBody.id, cancelled: false, restored: false }
          editRestoreRef.current = tracked
          scheduleReenqueueRetryRef.current(restoreBody, tracked)
          return undefined
        }
        // Move the restored row back to the slot it was taken from; the slot
        // follows removals of earlier rows via noteItemRemoved.
        const current = itemsRef.current
        const restoreSlot = Math.min(taken.slot, current.length)
        const anchor = restoreSlot === 0 ? ({ position: 'first' } as const) : { after: current[restoreSlot - 1].id }
        try {
          await reorderTrigger({ body: { moves: [{ id: restoreId, anchor }] } })
        } catch {
          // The draft is safe at the end of the queue; only its position is off.
          toast.error(t('message.error.operation_unavailable'))
        }
        if (restoreSlot <= incomingSlot) incomingSlot += 1
      }
      // A committed DELETE can still time out: retry once and treat NOT_FOUND
      // as deleted, so a lost response cannot drop the draft.
      let deleted = false
      for (let attempt = 0; attempt < 2 && !deleted; attempt++) {
        try {
          await takeDeleteTrigger({ params: { id } })
          deleted = true
        } catch (error) {
          if (isAlreadyResolved(error)) {
            deleted = true
          } else if (attempt === 1) {
            toast.error(t('message.error.operation_unavailable'))
            if (taken) {
              // The outgoing item is back in the queue and the take failed:
              // the edit session is over, its content stays as ordinary draft.
              takenEditRef.current = null
              cancelTrackedEditRestoreRef.current()
            }
            await releaseClaim()
            return undefined
          }
        }
      }
      if (claim.alreadySent) {
        // The content was already sent before a crash: the delete above is the
        // correct dequeue, but restoring its draft would invite a resend. The
        // outgoing item (if any) is back in the queue, so the session is over.
        if (taken) {
          takenEditRef.current = null
          cancelTrackedEditRestoreRef.current()
        }
        return undefined
      }
      if (scopeKeyRef.current !== scope || !mountedRef.current) {
        // Scope moved or the consumer unmounted while DELETE was pending: the
        // row is gone, but its draft belongs to the old scope — put it back at
        // the end of that scope's queue instead of restoring it into a composer
        // that can no longer receive it. (Unmount keeps the stale scopeKey, so
        // the scope comparison alone cannot see it.)
        let restored = false
        let conversationGone = false
        const restoreId = crypto.randomUUID()
        // The taken row's payload is already durable; rebuilding the body
        // re-derives fileEntryIds so the replacement row keeps attachment
        // ownership once the original row's references close (cherry-pr-review).
        let restoreBody: RestoreQueueBody | null = null
        try {
          restoreBody = await buildRestoreBody(restoreId, scope, item.draft, item.payload)
        } catch {
          // Persistence IPC failed: the background retry rebuilds the body each tick.
        }
        if (restoreBody) {
          for (let attempt = 0; attempt < 3 && !restored && !conversationGone; attempt++) {
            try {
              await enqueueTrigger({ body: restoreBody })
              restored = true
            } catch (error) {
              // The old conversation was permanently deleted; the service refuses
              // to recreate its rows. Otherwise transient — retry inline, then in
              // the background below.
              if (isAlreadyResolved(error)) conversationGone = true
            }
          }
        }
        if (!restored && !conversationGone) {
          toast.error(t('message.error.operation_unavailable'))
          scheduleReenqueueRetryRef.current(
            restoreBody ?? { id: restoreId, scopeKey: scope, draft: item.draft, payload: item.payload }
          )
        }
        takenEditRef.current = null
        return undefined
      }
      takenEditRef.current = { item, slot: Math.max(incomingSlot, 0), scopeKey: scope }
      return item
    },
    [claimItem, takeDeleteTrigger, enqueueTrigger, reorderTrigger, markFailedTrigger, t]
  )

  // Serialize the complete edit handoff: overlapping takes can both observe
  // no outgoing edit, close their separate rows, and return drafts that
  // successively replace the composer, losing the first one (cherry-pr-review).
  const takeChainRef = useRef<Promise<unknown>>(Promise.resolve())
  const takeForEdit = useCallback<FollowupQueueController['takeForEdit']>(
    (id, captureOutgoing) => {
      const run = takeChainRef.current.then(() => takeForEditInner(id, captureOutgoing))
      takeChainRef.current = run.catch(() => undefined)
      return run
    },
    [takeForEditInner]
  )

  const releaseEdit = useCallback(() => {
    takenEditRef.current = null
    cancelTrackedEditRestoreRef.current()
  }, [])

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
      const scope = scopeKeyRef.current
      setPausedOverride({ scopeKey: scope, paused: nextPaused })
      const request = { scopeKey: scope, paused: nextPaused }
      // Coalesce rapid toggles within this scope: only the latest queued
      // request is sent after the in-flight PUT settles, so the server ends
      // with the user's choice. Other scopes' writes are untouched.
      if (pausedInflightRef.current.has(scope)) {
        pausedQueuedRef.current.set(scope, nextPaused)
        return
      }
      pausedInflightRef.current.add(scope)
      const send = async (current: { scopeKey: string; paused: boolean }) => {
        try {
          await setPausedTrigger({ body: { scopeKey: current.scopeKey, paused: current.paused } })
        } catch {
          toast.error(t('message.error.operation_unavailable'))
          // Release the optimistic hold so a failed Pause cannot park the
          // drain. Only clear when the hold still matches this request: a
          // newer toggle issued mid-flight owns the hold now.
          setPausedOverride((prev) =>
            prev?.scopeKey === current.scopeKey && prev.paused === current.paused ? null : prev
          )
        }
      }
      void (async () => {
        await send(request)
        let queued = pausedQueuedRef.current.get(scope)
        while (queued !== undefined) {
          pausedQueuedRef.current.delete(scope)
          await send({ scopeKey: scope, paused: queued })
          queued = pausedQueuedRef.current.get(scope)
        }
        pausedInflightRef.current.delete(scope)
      })()
    },
    [setPausedTrigger, t]
  )

  // Ownership heartbeat while an owned send is in flight: refreshes the claim
  // lease so a slow send is never reclaimed and replayed by another window.
  // Started on a claim win, stopped by settleItem (the single choke point for
  // every owned-claim resolution). Transport failures keep beating — the send
  // still owns the row until it settles — and a dead row stops the timer.
  const startHeartbeat = useCallback(
    (id: string, claimToken: string) => {
      if (pendingHeartbeatRef.current.has(id)) return
      const tick = () => {
        void (async () => {
          try {
            const result = await heartbeatTrigger({ params: { id }, body: { claimToken } })
            if (!result.live) {
              const timer = pendingHeartbeatRef.current.get(id)
              if (timer !== undefined) clearInterval(timer)
              pendingHeartbeatRef.current.delete(id)
            }
          } catch {
            // Retry on the next tick; the reclaim lease still bounds a stall.
          }
        })()
      }
      pendingHeartbeatRef.current.set(id, setInterval(tick, FOLLOWUP_QUEUE_HEARTBEAT_MS))
    },
    [heartbeatTrigger]
  )

  // Background resolve that never gives up while the row is unsettled:
  // after the inline attempts fail, the row would otherwise sit `sending`
  // until the reclaim lease expires and a later claim replays an already-sent
  // message. Retries run on a timer with no attempt cap — a permanently
  // failing write means the data layer is down, and each tick is a single
  // statement — and refetch on success so mirrors converge; they survive
  // unmount because a sent row must still be dequeued when its composer
  // is gone.
  const scheduleResolveRetryRef = useRef<(id: string, sent: boolean, claimToken: string) => void>(() => {})
  scheduleResolveRetryRef.current = (id: string, sent: boolean, claimToken: string) => {
    if (pendingResolveRef.current.has(id)) return
    const tick = () => {
      // Release the slot before attempting: the chained schedule on failure
      // would otherwise see the pending entry and stop the chain after one
      // background attempt.
      pendingResolveRef.current.delete(id)
      void (async () => {
        try {
          if (sent) {
            await removeTrigger({ params: { id } })
            noteItemRemoved(
              id,
              itemsRef.current.findIndex((entry) => entry.id === id)
            )
          } else await markFailedTrigger({ params: { id }, body: { claimToken } })
          if (mountedRef.current) void refetch()
        } catch (error) {
          if (isAlreadyResolved(error)) {
            // The row is gone, so the dequeue already took effect.
            if (mountedRef.current) void refetch()
            return
          }
          scheduleResolveRetryRef.current(id, sent, claimToken)
        }
      })()
    }
    pendingResolveRef.current.set(id, setTimeout(tick, 5000))
  }

  // Background restore for a take orphaned by a mid-delete scope switch whose
  // replacement enqueue keeps failing. Uncapped like resolve retries — each
  // tick is one statement — and refetches on success so mirrors converge.
  // Cancel the session's tracked restore retry (if any): the timer, a copy
  // the retry already landed while the item sat in the editor, and the record
  // itself. In-flight writes reconcile through the record's cancelled flag.
  const cancelTrackedEditRestoreRef = useRef<() => void>(() => {})
  cancelTrackedEditRestoreRef.current = () => {
    const tracked = editRestoreRef.current
    editRestoreRef.current = null
    if (!tracked) return
    tracked.cancelled = true
    const timer = pendingReenqueueRef.current.get(tracked.restoreId)
    if (timer !== undefined) {
      clearTimeout(timer)
      pendingReenqueueRef.current.delete(tracked.restoreId)
    }
    if (tracked.restored) {
      // The retry already re-queued the item during the session: the session's
      // end (sent/cleared/replaced) must not leave a deliverable copy behind.
      void removeTrigger({ params: { id: tracked.restoreId } }).catch(() => {})
    }
  }

  const scheduleReenqueueRetryRef = useRef<(body: RestoreQueueBody, tracked?: TrackedEditRestore) => void>(() => {})
  scheduleReenqueueRetryRef.current = (body: RestoreQueueBody, tracked?: TrackedEditRestore) => {
    if (pendingReenqueueRef.current.has(body.id)) return
    const tick = () => {
      pendingReenqueueRef.current.delete(body.id)
      if (tracked?.cancelled) return
      void (async () => {
        try {
          // Rebuild per tick: a failed inline persist gets another chance, and
          // an already-durable payload passes through unchanged.
          await enqueueTrigger({ body: await buildRestoreBody(body.id, body.scopeKey, body.draft, body.payload) })
          if (tracked) {
            if (tracked.cancelled) {
              // The edit session ended while the write was in flight: reconcile
              // — the landed copy must not outlive the session it belonged to.
              void removeTrigger({ params: { id: body.id } }).catch(() => {})
              return
            }
            tracked.restored = true
          }
          if (mountedRef.current) void refetch()
        } catch (error) {
          // The conversation was permanently deleted: the service refuses to
          // recreate its rows, so there is nothing left to restore into.
          if (isAlreadyResolved(error)) return
          scheduleReenqueueRetryRef.current(body, tracked)
        }
      })()
    }
    pendingReenqueueRef.current.set(body.id, setTimeout(tick, 5000))
  }

  // Resolve a won claim: dequeue on success, mark failed otherwise. Retried so
  // a successful send is not replayed after a lost dequeue write. Also stops
  // the ownership heartbeat: every owned claim ends here.
  const settleItem = useCallback(
    async (id: string, sent: boolean, claimToken: string) => {
      const heartbeatTimer = pendingHeartbeatRef.current.get(id)
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
      pendingHeartbeatRef.current.delete(id)
      const removalIndex = sent ? itemsRef.current.findIndex((entry) => entry.id === id) : -1
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (sent) {
            await removeTrigger({ params: { id } })
            noteItemRemoved(id, removalIndex)
          } else await markFailedTrigger({ params: { id }, body: { claimToken } })
          return true
        } catch (error) {
          // The row is already gone: resolving a deletion against it would
          // retry a terminal outcome forever.
          if (isAlreadyResolved(error)) {
            return true
          }
          // Transient IPC/DB failure — retry before giving up.
        }
      }
      scheduleResolveRetryRef.current(id, sent, claimToken)
      return false
    },
    [removeTrigger, markFailedTrigger, noteItemRemoved]
  )

  // Shared delivery for a won claim (steer + auto-drain): scope check, skip when
  // already sent, heartbeat-guarded send, sent-marker, settle. Resolves sent/not.
  const deliverWonClaim = useCallback(
    async (args: {
      id: string
      scope: string
      claimToken: string
      payload: ComposerQueuedMessagePayload
      alreadySent: boolean
      send: (payload: ComposerQueuedMessagePayload) => Promise<boolean>
      /** Edge-driven ack hook: fires where the drain used to ack (pre-send + already-sent skip). */
      onCommitted?: () => void
    }): Promise<boolean> => {
      const { id, scope, claimToken, payload, alreadySent, send, onCommitted } = args
      // Unmounted while the claim was in flight: release it without sending —
      // no composer is left to own the result. The row stays queued.
      if (!mountedRef.current) {
        await settleItem(id, false, claimToken)
        return false
      }
      // Scope switched mid-flight: release the claim without sending — the payload
      // belongs to the previous scope. Only our own won claim reaches here.
      if (scopeKeyRef.current !== scope) {
        await settleItem(id, false, claimToken)
        return false
      }
      if (alreadySent) {
        // Crash recovery: already sent before dying — dequeue silently.
        await settleItem(id, true, claimToken)
        onCommitted?.()
        return true
      }
      onCommitted?.()
      startHeartbeat(id, claimToken)
      let sent = false
      let unresolvedSend: Promise<boolean> | null = null
      try {
        const pending = send(payload)
        const outcome = await awaitSendWithTimeout(pending)
        sent = outcome.sent
        if (outcome.timedOut) unresolvedSend = pending
      } catch {
        sent = false
      }
      if (unresolvedSend) {
        // The outcome is unknown: the send may still succeed. Keep the claim
        // and its heartbeat until the operation resolves definitively —
        // settling failed here makes the row claimable while the original send
        // is live, and a redrain that wins the race against the late repair
        // delivers the message twice (cherry-pr-review). A late success marks
        // and dequeues without resending; a definitive failure releases the
        // row back to failed for the next completion.
        void unresolvedSend.then(
          async (late) => {
            if (late) {
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  await markSentTrigger({ params: { id }, body: { claimToken } })
                  break
                } catch {
                  // Transient failure — the settlement still dequeues below.
                }
              }
            }
            await settleItem(id, late, claimToken)
          },
          () => {
            void settleItem(id, false, claimToken)
          }
        )
        return false
      }
      if (sent) {
        // Record the send before resolving so a crash replays as a skip, never
        // a resend. Retried; if marking keeps failing the resolve retry still dequeues.
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await markSentTrigger({ params: { id }, body: { claimToken } })
            break
          } catch {
            // Transient failure — retry before settling.
          }
        }
      }
      const settled = await settleItem(id, sent, claimToken)
      if (!settled && sent) {
        toast.error(t('message.error.operation_unavailable'))
      }
      return sent
    },
    [settleItem, startHeartbeat, markSentTrigger, t]
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
        const result = await claimItem(id)
        if (!result) {
          toast.error(t('message.error.operation_unavailable'))
          return false
        }
        if (!result.claim.claimed) return false
        return await deliverWonClaim({
          id,
          scope,
          claimToken: result.claimToken,
          payload: item.payload,
          alreadySent: result.claim.alreadySent,
          send
        })
      } finally {
        activeIdsRef.current.delete(id)
      }
    },
    [claimItem, deliverWonClaim, t]
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
      if (
        statusRef.current !== 'done' ||
        lastCompletedAtRef.current == null ||
        loadConsumed(scopeKeyRef.current) === lastCompletedAtRef.current ||
        drainBlockedRef.current ||
        !head
      )
        return
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
    // Snapshot the send path with the scope: the handler closes over the current
    // conversation, so a scope switch mid-drain must not redirect the old payload.
    const sendForScope = onDrainRef.current
    // Bind the consumption marker to the completion that initiated this
    // drain: by the time an alreadySent recovery settles, lastCompletedAtRef
    // may point at a newer turn, which must drain its own follow-up.
    const completionAt = lastCompletedAtRef.current
    const ackCompletion = () => {
      if (completionAt != null) cacheService.setShared(consumedKeyFor(scope), completionAt)
    }
    if (drainBusyScopesRef.current.has(scope) || activeIdsRef.current.has(head.id)) return
    drainBusyScopesRef.current.add(scope)
    activeIdsRef.current.add(head.id)
    let settled = false
    try {
      let won: ClaimHeadFollowupQueueResult | undefined
      // Retry-stable: a committed claim whose response timed out is re-acquired by the retry, not lost to it.
      const claimToken = crypto.randomUUID()
      for (let attempt = 0; attempt < 2 && !won; attempt++) {
        try {
          won = await claimHeadTrigger({
            body: { scopeKey: scope, claimToken, completionAt: completionAt ?? undefined }
          })
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
        if (scopeKeyRef.current === scope && itemsRef.current[0]) ackCompletion()
        return
      }
      const target = itemsRef.current.find((entry) => entry.id === won.id)
      if (!target) {
        // Won the true head but the mirror hasn't caught up: release it back
        // to failed (immediately reclaimable) and preserve the edge — the
        // resolve notification re-fires this cycle with fresh data.
        await settleItem(won.id, false, claimToken)
        onDrainFailedRef.current?.()
        void refetch()
        return
      }
      const sent = await deliverWonClaim({
        id: won.id,
        scope,
        claimToken,
        payload: target.payload,
        alreadySent: won.alreadySent,
        send: (payload) => sendForScope(payload),
        onCommitted: ackCompletion
      })
      if (!sent) onDrainFailedRef.current?.()
      settled = true
    } finally {
      drainBusyScopesRef.current.delete(scope)
      activeIdsRef.current.delete(head.id)
      // Releasing the busy guard does not re-fire the drain effect: a
      // completion that arrived while this scope was busy exited at the
      // guard. After a settlement, re-drive the drain when an unconsumed
      // completion is still pending (same gates as the claim retry). Never
      // re-drive for an unmounted consumer: its delivery releases the next
      // claim, and restarting would sustain claim/fail cycles on the row
      // (cherry-pr-review). Settling the existing delivery above is unaffected.
      if (settled && mountedRef.current) {
        const pendingHead = itemsRef.current[0]
        if (
          statusRef.current === 'done' &&
          lastCompletedAtRef.current != null &&
          loadConsumed(scopeKeyRef.current) !== lastCompletedAtRef.current &&
          !drainBlockedRef.current &&
          pendingHead
        ) {
          void drainHeadRef.current(pendingHead)
        }
      }
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
    if (status !== 'done' || lastCompletedAt == null || paused || !queriesReady || !pauseKnown) return
    if (loadConsumed(scopeKey) === lastCompletedAt) return
    const head = itemsRef.current[0]
    if (!head || head.id !== headId) return
    void drainHeadRef.current(head)
  }, [status, lastCompletedAt, paused, queriesReady, pauseKnown, headId, scopeKey])

  return { items, enqueue, removeId, reorder, paused, setPaused, steer, takeForEdit, releaseEdit }
}
