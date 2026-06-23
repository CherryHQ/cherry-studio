import { cacheService } from '@data/CacheService'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ComposerSerializedDraft } from './tokens'

export interface FollowupQueueItem {
  id: string
  /** Serialized draft (text + tokens) — drives the dock preview and edit-restore. */
  draft: ComposerSerializedDraft
  /** Send-ready payload (text + parts + files/models) captured at enqueue time. */
  payload: ComposerQueuedMessagePayload
}

/** Same per-window memory tier + TTL as the inputbar draft cache (`composerDraft` / ChatComposer). */
const QUEUE_TTL = 24 * 60 * 60 * 1000
const keyFor = (scopeKey: string) => `followup-queue.${scopeKey}`

/** Load + validate a persisted queue (the cache holds arbitrary JSON; guard non-array entries). */
function loadQueue(scopeKey: string): FollowupQueueItem[] {
  const cached = cacheService.getCasual<FollowupQueueItem[]>(keyFor(scopeKey))
  return Array.isArray(cached) ? cached : []
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
  /**
   * Called when an auto-drain attempt fails. The completion edge was already consumed by
   * `markSeen`, so the head stays stuck with no auto-retry — surface it (e.g. a toast).
   */
  onDrainFailed?: () => void
}

export interface FollowupQueueController {
  items: FollowupQueueItem[]
  enqueue: (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => void
  removeId: (id: string) => void
  reorder: (nextItems: FollowupQueueItem[]) => void
  paused: boolean
  setPaused: (paused: boolean) => void
}

/**
 * Per-conversation FIFO queue of follow-up drafts. While a turn streams the composer enqueues here
 * instead of sending; on the live→idle edge the head auto-drains (one per completion), and the dock
 * lets the user steer/edit/remove individual items or pause auto-drain. Persistence mirrors the
 * draft cache (`cacheService.setCasual`, per-window memory + TTL).
 */
export function useFollowupQueue({
  scopeKey,
  isFulfilled,
  markSeen,
  onDrain,
  onDrainFailed
}: UseFollowupQueueParams): FollowupQueueController {
  const [items, setItems] = useState<FollowupQueueItem[]>(() => loadQueue(scopeKey))
  const [paused, setPaused] = useState(false)

  // Latest values for the persistence + drain closures (kept off the effect deps to avoid re-running).
  const scopeKeyRef = useRef(scopeKey)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const onDrainRef = useRef(onDrain)
  onDrainRef.current = onDrain
  const onDrainFailedRef = useRef(onDrainFailed)
  onDrainFailedRef.current = onDrainFailed

  const persist = useCallback((next: FollowupQueueItem[]) => {
    cacheService.setCasual(keyFor(scopeKeyRef.current), next, QUEUE_TTL)
  }, [])

  // Reload when switching conversations; the previous queue stays in its own scoped cache entry.
  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return
    scopeKeyRef.current = scopeKey
    setItems(loadQueue(scopeKey))
    setPaused(false)
  }, [scopeKey])

  const enqueue = useCallback(
    (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => {
      setItems((prev) => {
        const next = [...prev, { id: crypto.randomUUID(), draft, payload }]
        persist(next)
        return next
      })
    },
    [persist]
  )

  const removeId = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = prev.filter((item) => item.id !== id)
        persist(next)
        return next
      })
    },
    [persist]
  )

  const reorder = useCallback(
    (nextItems: FollowupQueueItem[]) => {
      setItems(nextItems)
      persist(nextItems)
    },
    [persist]
  )

  // Drain one message per completion: on the live→idle edge, acknowledge it (so it fires once) and
  // send the head; on success dequeue. The next send goes busy→idle again and drains the next item.
  useEffect(() => {
    if (!isFulfilled || paused) return
    const head = itemsRef.current[0]
    if (!head) return
    markSeen()
    void onDrainRef.current(head.payload).then((sent) => {
      if (sent) removeId(head.id)
      else onDrainFailedRef.current?.()
    })
  }, [isFulfilled, paused, markSeen, removeId])

  return { items, enqueue, removeId, reorder, paused, setPaused }
}
