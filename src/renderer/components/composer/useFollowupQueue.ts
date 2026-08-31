import { cacheService } from '@data/CacheService'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import type { FollowupQueueItem } from '@shared/data/cache/cacheValueTypes'
import { isEqual } from 'es-toolkit/compat'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ComposerSerializedDraft } from './tokens'

export const QUEUE_LIMIT = 20

export type { FollowupQueueItem }

/**
 * Per-conversation queue state persisted under one schema key (localStorage tier), so pending
 * follow-ups survive app restarts and stay in sync across windows.
 */
const QUEUE_STORAGE_KEY = 'ui.composer.followup_queue'

interface FollowupQueueState {
  items: FollowupQueueItem[]
  paused: boolean
}

/** Load + validate a persisted queue (persist cache holds arbitrary JSON; discard malformed entries). */
function loadState(scopeKey: string): FollowupQueueState {
  try {
    const queues = cacheService.getPersist(QUEUE_STORAGE_KEY) as unknown
    if (!queues || typeof queues !== 'object' || Array.isArray(queues)) return { items: [], paused: false }
    const entry = (queues as Record<string, unknown>)[scopeKey]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { items: [], paused: false }
    const raw = entry as { items?: unknown; paused?: unknown }
    const items = Array.isArray(raw.items)
      ? (raw.items as unknown[]).filter(
          (item) =>
            item != null &&
            typeof item === 'object' &&
            typeof (item as { id?: unknown }).id === 'string' &&
            (item as { payload?: unknown }).payload != null
        )
      : []
    return {
      items: items as unknown as FollowupQueueItem[],
      paused: raw.paused === true
    }
  } catch {
    return { items: [], paused: false }
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

function isWindowFocused(): boolean {
  if (typeof document === 'undefined' || typeof document.hasFocus !== 'function') return true
  try {
    if (!document.hasFocus()) {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
      if (!/jsdom|vitest/i.test(ua)) return false
    }
  } catch {
    // hasFocus may throw in some environments — fall through as focused.
  }
  return true
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
  const isFulfilledRef = useRef(isFulfilled)
  isFulfilledRef.current = isFulfilled
  const markSeenRef = useRef(markSeen)
  markSeenRef.current = markSeen

  const persist = useCallback((next: FollowupQueueState) => {
    persistState(scopeKeyRef.current, next.items, next.paused)
  }, [])

  // Reload when switching conversations; the previous queue stays in its own scoped entry.
  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return
    scopeKeyRef.current = scopeKey
    // A drain in flight for the previous scope must not settle into the new scope's queue.
    drainEpochRef.current += 1
    drainingIdRef.current = null
    const next = loadState(scopeKey)
    // Sync the ref before React commits the new state — otherwise the drain effect
    // running in the same commit would still see the previous conversation's items
    // and could drain the old head through the new conversation's completion edge.
    stateRef.current = next
    setState(next)
    setFailedItemId(null)
  }, [scopeKey])

  const enqueue = useCallback(
    (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => {
      if (stateRef.current.items.length >= QUEUE_LIMIT) return false
      const newItem = { id: crypto.randomUUID(), draft, payload } as unknown as FollowupQueueItem
      setState((prev) => {
        if (prev.items.length >= QUEUE_LIMIT) return prev
        const next = { ...prev, items: [...prev.items, newItem] }
        persist(next)
        return next
      })
      return true
    },
    [persist]
  )

  const reorder = useCallback(
    (nextItems: FollowupQueueItem[]) => {
      setState((prev) => {
        const next = { ...prev, items: nextItems }
        persist(next)
        stateRef.current = next
        return next
      })
    },
    [persist]
  )

  const clear = useCallback(() => {
    drainEpochRef.current += 1
    drainingIdRef.current = null
    const next = { items: [], paused: false }
    persist(next)
    setState(next)
    stateRef.current = next
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
  const failHeadRef = useRef(failHead)
  failHeadRef.current = failHead

  const removeIdRef = useRef<(id: string) => void>(() => {})
  const drainHead = useCallback((head: FollowupQueueItem | undefined) => {
    if (!head || drainingIdRef.current !== null) return
    drainingIdRef.current = head.id
    const epoch = drainEpochRef.current
    void onDrainRef.current(head.payload).then(
      (sent) => {
        drainingIdRef.current = null
        if (drainEpochRef.current !== epoch) return
        if (sent) removeIdRef.current(head.id)
        else failHeadRef.current(head.id)
      },
      () => {
        drainingIdRef.current = null
        if (drainEpochRef.current !== epoch) return
        failHeadRef.current(head.id)
      }
    )
  }, [])

  const removeId = useCallback(
    (id: string) => {
      const wasFailed = failedItemIdRef.current === id
      if (drainingIdRef.current === id) {
        drainEpochRef.current += 1
        drainingIdRef.current = null
      }
      setState((prev) => {
        const filtered = prev.items.filter((item) => item.id !== id)
        const next: FollowupQueueState = {
          items: filtered,
          paused: wasFailed ? false : prev.paused
        }
        persist(next)
        stateRef.current = next
        return next
      })
      if (wasFailed) setFailedItemId(null)
    },
    [persist]
  )
  removeIdRef.current = removeId

  const setPaused = useCallback(
    (nextPaused: boolean) => {
      const next = { ...stateRef.current, paused: nextPaused }
      persist(next)
      setState(next)
      stateRef.current = next
      if (!nextPaused && isFulfilledRef.current && !failedItemIdRef.current && drainingIdRef.current === null) {
        if (!isWindowFocused()) return
        const head = next.items[0]
        if (head) {
          markSeenRef.current()
          drainHead(head)
        }
      }
    },
    [persist, drainHead]
  )

  // Drain one message per completion: on the live→idle edge, acknowledge it (so it fires once) and
  // send the head; on success dequeue. The next send goes busy→idle again and drains the next item.
  // While a failure is unresolved the user must Skip/Retry/Abort — no automatic re-drain.
  // When the same conversation is open in two windows (detached via openConversationWindow),
  // both windows share the persist queue and both see isFulfilled. Gate auto-drain to the
  // focused window so the head is not sent twice.
  useEffect(() => {
    if (!isFulfilled || stateRef.current.paused || failedItemIdRef.current || drainingIdRef.current !== null) {
      return
    }
    if (!isWindowFocused()) return
    const head = stateRef.current.items[0]
    if (!head) return
    markSeen()
    drainHead(head)
  }, [isFulfilled, markSeen, drainHead])

  // Keep local queue in sync with cross-window persist broadcasts. The hook writes via
  // imperative getPersist/setPersist so without a subscription an unfocused window would
  // keep a stale stateRef and attempt to drain an already-removed head when it regains focus.
  useEffect(() => {
    return cacheService.subscribe(QUEUE_STORAGE_KEY, () => {
      const next = loadState(scopeKeyRef.current)
      if (isEqual(next, stateRef.current)) return
      // If the failed item was removed externally, clear the failure so drains can resume.
      if (failedItemIdRef.current && !next.items.some((item) => item.id === failedItemIdRef.current)) {
        setFailedItemId(null)
      }
      // If the draining item disappeared externally, invalidate its resolution.
      if (drainingIdRef.current && !next.items.some((item) => item.id === drainingIdRef.current)) {
        drainEpochRef.current += 1
        drainingIdRef.current = null
      }
      stateRef.current = next
      setState(next)
    })
  }, [])

  const retryFailed = useCallback(() => {
    const failed = failedItemIdRef.current
    // A retry is already in flight — never start a second concurrent send.
    if (!failed || drainingIdRef.current !== null) return
    drainHead(stateRef.current.items.find((item) => item.id === failed))
  }, [drainHead])

  const skipFailed = useCallback(() => {
    const failed = failedItemIdRef.current
    if (!failed || drainingIdRef.current !== null) return
    const remaining = stateRef.current.items.filter((item) => item.id !== failed)
    setFailedItemId(null)
    const next = { items: remaining, paused: false }
    persist(next)
    setState(next)
    stateRef.current = next
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
