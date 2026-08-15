import { cacheService } from '@data/CacheService'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ComposerSerializedDraft } from './tokens'

export const QUEUE_LIMIT = 20

export interface FollowupQueueItem {
  id: string
  /** Serialized draft (text + tokens) — drives the dock preview and edit-restore. */
  draft: ComposerSerializedDraft
  /** Send-ready payload (text + parts + files/models) captured at enqueue time. */
  payload: ComposerQueuedMessagePayload
}

/**
 * Per-conversation queue state persisted under one schema key (localStorage tier), so pending
 * follow-ups survive app restarts and stay in sync across windows.
 */
const QUEUE_STORAGE_KEY = 'ui.composer.followup_queue'

interface FollowupQueueState {
  items: FollowupQueueItem[]
  paused: boolean
}

/** Load + validate a persisted queue (persist cache holds arbitrary JSON; guard non-array entries). */
function loadState(scopeKey: string): FollowupQueueState {
  const queues = cacheService.getPersist(QUEUE_STORAGE_KEY)
  const entry = queues[scopeKey]
  if (!entry) return { items: [], paused: false }
  return {
    items: Array.isArray(entry.items) ? (entry.items as unknown as FollowupQueueItem[]) : [],
    paused: entry.paused === true
  }
}

/**
 * Write one conversation's queue; entries drained to empty are dropped to keep storage bounded.
 * Uses the functional updater so concurrent writes from other windows (same persist tier) merge
 * against the latest stored value instead of clobbering each other's entries.
 */
function persistState(scopeKey: string, items: FollowupQueueItem[], paused: boolean): void {
  cacheService.setPersist(QUEUE_STORAGE_KEY, (prev) => {
    const next = { ...prev }
    if (items.length === 0 && !paused) {
      delete next[scopeKey]
    } else {
      next[scopeKey] = { items, paused }
    }
    return next
  })
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
}

export interface FollowupQueueController {
  items: FollowupQueueItem[]
  /** Queue a follow-up; returns false when the per-conversation limit is reached. */
  enqueue: (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => boolean
  removeId: (id: string) => void
  reorder: (nextItems: FollowupQueueItem[]) => void
  /** Drop every pending message (and any failure state) and resume auto-drain. */
  clear: () => void
  paused: boolean
  setPaused: (paused: boolean) => void
  /** Head item whose send failed; the queue auto-pauses until the user resolves it. */
  failedItemId: string | null
  /** Re-send the failed head. */
  retryFailed: () => void
  /** Drop the failed head and continue with the next queued message. */
  skipFailed: () => void
}

/**
 * Per-conversation FIFO queue of follow-up drafts. While a turn streams the composer enqueues here
 * instead of sending; on the live→idle edge the head auto-drains (one per completion), and the dock
 * lets the user steer/edit/remove individual items, pause auto-drain, or clear the queue. A failed
 * drain auto-pauses and marks the head as failed for the user to Skip / Retry / Abort. Persisted in
 * the renderer persist cache (localStorage) so pending follow-ups survive app restarts.
 */
export function useFollowupQueue({
  scopeKey,
  isFulfilled,
  markSeen,
  onDrain
}: UseFollowupQueueParams): FollowupQueueController {
  const [state, setState] = useState<FollowupQueueState>(() => loadState(scopeKey))
  const [failedItemId, setFailedItemId] = useState<string | null>(null)

  // Serialize drains: only one send may be in flight per queue at a time.
  const drainingIdRef = useRef<string | null>(null)
  // Bumped whenever queue mutations invalidate an in-flight drain's resolution (clear / removing
  // the drained item / scope switch), so a settled drain cannot resurrect state for a dropped item.
  const drainEpochRef = useRef(0)

  // Latest values for the persistence + drain closures (kept off the effect deps to avoid re-running).
  const scopeKeyRef = useRef(scopeKey)
  const stateRef = useRef(state)
  stateRef.current = state
  const failedItemIdRef = useRef(failedItemId)
  failedItemIdRef.current = failedItemId
  const onDrainRef = useRef(onDrain)
  onDrainRef.current = onDrain

  const persist = useCallback((next: FollowupQueueState) => {
    persistState(scopeKeyRef.current, next.items, next.paused)
  }, [])

  // Reload when switching conversations; the previous queue stays in its own scoped entry.
  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return
    scopeKeyRef.current = scopeKey
    // A drain in flight for the previous scope must not settle into the new scope's queue.
    drainEpochRef.current += 1
    setState(loadState(scopeKey))
    setFailedItemId(null)
  }, [scopeKey])

  const setPaused = useCallback(
    (nextPaused: boolean) => {
      const next = { ...stateRef.current, paused: nextPaused }
      persist(next)
      setState(next)
    },
    [persist]
  )

  const enqueue = useCallback(
    (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => {
      if (stateRef.current.items.length >= QUEUE_LIMIT) return false
      setState((prev) => {
        const next = { ...prev, items: [...prev.items, { id: crypto.randomUUID(), draft, payload }] }
        persist(next)
        return next
      })
      return true
    },
    [persist]
  )

  const removeId = useCallback(
    (id: string) => {
      // Removing the item an in-flight drain is sending invalidates its resolution.
      if (drainingIdRef.current === id) drainEpochRef.current += 1
      setState((prev) => {
        const next = { ...prev, items: prev.items.filter((item) => item.id !== id) }
        // Removing the failed head resolves the failure; the queue resumes like a skip.
        if (failedItemIdRef.current === id) next.paused = false
        persist(next)
        return next
      })
      if (failedItemIdRef.current === id) setFailedItemId(null)
    },
    [persist]
  )

  const reorder = useCallback(
    (nextItems: FollowupQueueItem[]) => {
      setState((prev) => {
        const next = { ...prev, items: nextItems }
        persist(next)
        return next
      })
    },
    [persist]
  )

  const clear = useCallback(() => {
    // An in-flight drain's resolution targets an item we just dropped — invalidate it.
    drainEpochRef.current += 1
    const next = { items: [], paused: false }
    persist(next)
    setState(next)
    setFailedItemId(null)
  }, [persist])

  // Mark the head as failed and auto-pause; the user resolves it via the dock (Skip/Retry/Abort).
  const failHead = useCallback(
    (id: string) => {
      setFailedItemId(id)
      setState((prev) => {
        const next = { ...prev, paused: true }
        persist(next)
        return next
      })
    },
    [persist]
  )

  const drainHead = useCallback(
    (head: FollowupQueueItem | undefined) => {
      if (!head || drainingIdRef.current !== null) return
      drainingIdRef.current = head.id
      const epoch = drainEpochRef.current
      void onDrainRef.current(head.payload).then(
        (sent) => {
          drainingIdRef.current = null
          // The queue moved on while the send was in flight (cleared/removed/scope switch) —
          // drop the resolution instead of resurrecting failure state for a gone item.
          if (drainEpochRef.current !== epoch) return
          if (sent) removeId(head.id)
          else failHead(head.id)
        },
        () => {
          drainingIdRef.current = null
          if (drainEpochRef.current !== epoch) return
          failHead(head.id)
        }
      )
    },
    [failHead, removeId]
  )

  // Drain one message per completion: on the live→idle edge, acknowledge it (so it fires once) and
  // send the head; on success dequeue. The next send goes busy→idle again and drains the next item.
  // While a failure is unresolved the user must Skip/Retry/Abort — no automatic re-drain.
  useEffect(() => {
    if (!isFulfilled || stateRef.current.paused || failedItemIdRef.current || drainingIdRef.current !== null) {
      return
    }
    const head = stateRef.current.items[0]
    if (!head) return
    markSeen()
    drainHead(head)
  }, [isFulfilled, markSeen, drainHead])

  const retryFailed = useCallback(() => {
    const failed = failedItemIdRef.current
    // A retry is already in flight — never start a second concurrent send.
    if (!failed || drainingIdRef.current !== null) return
    drainHead(stateRef.current.items.find((item) => item.id === failed))
  }, [drainHead])

  const skipFailed = useCallback(() => {
    const failed = failedItemIdRef.current
    // A retry is already re-sending the failed head; let it settle instead of racing it.
    if (!failed || drainingIdRef.current !== null) return
    const remaining = stateRef.current.items.filter((item) => item.id !== failed)
    setFailedItemId(null)
    const next = { items: remaining, paused: false }
    persist(next)
    setState(next)
    // Idle now (the failed turn already completed) — keep the queue moving by sending the next head.
    drainHead(remaining[0])
  }, [drainHead, persist])

  return {
    items: state.items,
    enqueue,
    removeId,
    reorder,
    clear,
    paused: state.paused,
    setPaused,
    failedItemId,
    retryFailed,
    skipFailed
  }
}
