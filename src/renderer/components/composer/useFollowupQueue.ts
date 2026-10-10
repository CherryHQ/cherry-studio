import { useCallback, useEffect, useRef, useState } from 'react'

import { cacheService } from '@data/CacheService'
import type { ComposerQueuedMessagePayload, TopicStreamStatus } from '@shared/ai/transport'

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
const drainedKeyFor = (scopeKey: string) => `followup-queue-drained.${scopeKey}`
const sendingKeyFor = (scopeKey: string, id: string) => `followup-queue-sending.${scopeKey}.${id}`
const pausedKeyFor = (scopeKey: string) => `followup-queue-paused.${scopeKey}`
const EMPTY_QUEUE: FollowupQueueItem[] = []

/** Load + validate a persisted queue (the cache holds arbitrary JSON; guard non-array entries). */
function loadQueue(scopeKey: string): FollowupQueueItem[] {
  const cached = cacheService.getCasual<FollowupQueueItem[]>(keyFor(scopeKey))
  return Array.isArray(cached) ? cached : EMPTY_QUEUE
}

function loadPaused(scopeKey: string): boolean {
  return cacheService.getCasual<boolean>(pausedKeyFor(scopeKey)) === true
}

interface UseFollowupQueueParams {
  /** Per-conversation key — same `${topicId}:${assistantId}` scope as the draft cache. */
  scopeKey: string
  /** Stream completion is independent of the conversation list read receipt. */
  status: TopicStreamStatus | undefined
  lastCompletedAt: number | null
  /** Send a payload (busy → backend steer; idle → normal send). Resolves to whether it was sent. */
  onDrain: (payload: ComposerQueuedMessagePayload) => Promise<boolean>
  /** Called when auto-drain fails and leaves the queued item in place. */
  onDrainFailed?: () => void
}

export interface FollowupQueueController {
  items: FollowupQueueItem[]
  enqueue: (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => void
  sendId: (id: string) => Promise<boolean>
  removeId: (id: string) => void
  reorder: (nextItems: FollowupQueueItem[]) => void
  paused: boolean
  setPaused: (paused: boolean) => void
}

/**
 * Per-conversation FIFO queue of follow-up drafts. While a turn streams the composer enqueues here
 * instead of sending; on the live→idle edge the head auto-drains (one per completion), and the dock
 * lets the user steer/edit/remove individual items or pause auto-drain. Persistence mirrors the
 * draft cache (per-window memory + TTL); this queue remains on the casual cache API.
 */
export function useFollowupQueue({
  scopeKey,
  status,
  lastCompletedAt,
  onDrain,
  onDrainFailed
}: UseFollowupQueueParams): FollowupQueueController {
  const readState = useCallback(
    () => ({ scopeKey, items: loadQueue(scopeKey), paused: loadPaused(scopeKey) }),
    [scopeKey]
  )
  const [state, setState] = useState(readState)
  const onDrainRef = useRef(onDrain)
  onDrainRef.current = onDrain
  const onDrainFailedRef = useRef(onDrainFailed)
  onDrainFailedRef.current = onDrainFailed

  // The casual cache owns the queue across mounts, including sends finishing after a topic switch.
  useEffect(() => {
    const reload = () => {
      const next = readState()
      setState((current) =>
        current.scopeKey === next.scopeKey && current.items === next.items && current.paused === next.paused
          ? current
          : next
      )
    }
    const unsubscribeQueue = cacheService.subscribe(keyFor(scopeKey), reload)
    const unsubscribePaused = cacheService.subscribe(pausedKeyFor(scopeKey), reload)
    reload()
    return () => {
      unsubscribeQueue()
      unsubscribePaused()
    }
  }, [readState, scopeKey])

  const persist = useCallback(
    (next: FollowupQueueItem[]) => cacheService.setCasual(keyFor(scopeKey), next, QUEUE_TTL),
    [scopeKey]
  )
  const setPaused = useCallback((paused: boolean) => cacheService.setCasual(pausedKeyFor(scopeKey), paused), [scopeKey])
  const enqueue = useCallback(
    (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => {
      persist([...loadQueue(scopeKey), { id: crypto.randomUUID(), draft, payload }])
    },
    [persist, scopeKey]
  )
  const removeId = useCallback(
    (id: string) => persist(loadQueue(scopeKey).filter((item) => item.id !== id)),
    [persist, scopeKey]
  )

  const sendItem = useCallback(
    async (id: string, completedAt?: number): Promise<boolean> => {
      const item = loadQueue(scopeKey).find((entry) => entry.id === id)
      const sendingKey = sendingKeyFor(scopeKey, id)
      if (!item || cacheService.getCasual<boolean>(sendingKey)) return false

      // Manual steer and auto-drain share the claim, including across component remounts.
      // It lives until the send settles; a TTL must not release an active send.
      cacheService.setCasual(sendingKey, true)
      if (completedAt != null) {
        cacheService.setCasual(drainedKeyFor(scopeKey), { completedAt, inFlight: true }, QUEUE_TTL)
      }
      const reportFailure = onDrainFailedRef.current
      try {
        let sent = false
        try {
          sent = await onDrainRef.current(item.payload)
        } catch {
          // Both rejected sends and explicit failures retain the draft for retry.
        }
        if (sent) {
          if (completedAt != null) {
            cacheService.setCasual(drainedKeyFor(scopeKey), { completedAt, inFlight: false }, QUEUE_TTL)
          }
          removeId(id)
        } else if (completedAt != null) {
          setPaused(true)
          cacheService.deleteCasual(drainedKeyFor(scopeKey))
          reportFailure?.()
        }
        return sent
      } finally {
        cacheService.deleteCasual(sendingKey)
      }
    },
    [scopeKey, removeId, setPaused]
  )
  const sendId = useCallback((id: string) => sendItem(id), [sendItem])

  useEffect(() => {
    if (state.scopeKey !== scopeKey || status !== 'done' || lastCompletedAt == null || state.paused) return
    const head = state.items[0]
    const drained = cacheService.getCasual<{ completedAt: number; inFlight: boolean }>(drainedKeyFor(scopeKey))
    if (!head || drained?.inFlight || drained?.completedAt === lastCompletedAt) return
    void sendItem(head.id, lastCompletedAt)
  }, [scopeKey, status, lastCompletedAt, state, sendItem])

  return { items: state.items, enqueue, sendId, removeId, reorder: persist, paused: state.paused, setPaused }
}
