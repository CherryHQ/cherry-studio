import { useCallback, useEffect, useRef, useState } from 'react'

import { cacheService } from '@data/CacheService'
import { classifyTurn, type ComposerQueuedMessagePayload, type TopicStreamStatus } from '@shared/ai/transport'

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
const EMPTY_QUEUE: FollowupQueueItem[] = []
const keyFor = (scopeKey: string) => `followup-queue.${scopeKey}`
const drainedTurnKeyFor = (scopeKey: string) => `followup-queue-last-drained-turn.${scopeKey}`
const inflightKeyFor = (scopeKey: string) => `followup-queue-inflight.${scopeKey}`
const pausedKeyFor = (scopeKey: string) => `followup-queue-paused.${scopeKey}`

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
  status: TopicStreamStatus | undefined
  turnId: string | undefined
  /** False when this composer must not send (e.g. Agent edit mode / send disabled). */
  autoSendEnabled: boolean
  markSeen: () => void
  /** Send a payload (busy → backend steer; idle → normal send). Resolves to whether it was sent. */
  onDrain: (payload: ComposerQueuedMessagePayload) => Promise<boolean>
  /** Called when auto-drain fails and leaves the queued item in place. */
  onDrainFailed?: () => void
}

export interface FollowupQueueController {
  items: FollowupQueueItem[]
  enqueue: (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => void
  removeId: (id: string) => void
  reorder: (nextItems: FollowupQueueItem[]) => void
  takeForEdit(
    id: string,
    captureOutgoing: (taken: FollowupQueueItem) => Pick<FollowupQueueItem, 'draft' | 'payload'> | null
  ): FollowupQueueItem | null
  releaseEdit(): void
  beginSend(id: string): (() => void) | null
  paused: boolean
  setPaused: (paused: boolean) => void
}

/**
 * Window-local FIFO: attempt one head per identified terminal; retain, pause and notify on failure.
 * Drafts persist in the casual cache with a TTL; pause and turn receipts survive remounts.
 */
export function useFollowupQueue({
  scopeKey,
  status,
  turnId,
  autoSendEnabled,
  markSeen,
  onDrain,
  onDrainFailed
}: UseFollowupQueueParams): FollowupQueueController {
  const [items, setItems] = useState<FollowupQueueItem[]>(() => loadQueue(scopeKey))
  const [paused, setPausedState] = useState(() => loadPaused(scopeKey))

  // Latest values for the persistence + drain closures (kept off the effect deps to avoid re-running).
  const scopeKeyRef = useRef(scopeKey)
  const itemsRef = useRef(items)
  const takenRef = useRef<{ item: FollowupQueueItem; slot: number } | null>(null)
  const markSeenRef = useRef(markSeen)
  markSeenRef.current = markSeen
  const onDrainRef = useRef(onDrain)
  onDrainRef.current = onDrain
  const onDrainFailedRef = useRef(onDrainFailed)
  onDrainFailedRef.current = onDrainFailed

  const persist = useCallback((next: FollowupQueueItem[]) => {
    cacheService.setCasual(keyFor(scopeKeyRef.current), next, QUEUE_TTL)
  }, [])

  const reconcile = useCallback((next: FollowupQueueItem[]) => {
    const taken = takenRef.current
    if (taken) {
      const ids = new Set(next.map((item) => item.id))
      const removedBefore = itemsRef.current.filter((item, index) => index < taken.slot && !ids.has(item.id)).length
      taken.slot -= removedBefore
    }
    itemsRef.current = next
    setItems(next)
    return next
  }, [])

  useEffect(() => {
    if (scopeKeyRef.current !== scopeKey) {
      scopeKeyRef.current = scopeKey
      takenRef.current = null
      itemsRef.current = []
    }
    const reloadQueue = () => {
      if (scopeKeyRef.current === scopeKey) reconcile(loadQueue(scopeKey))
    }
    const reloadPaused = () => {
      if (scopeKeyRef.current === scopeKey) setPausedState(loadPaused(scopeKey))
    }
    const unsubscribeQueue = cacheService.subscribe(keyFor(scopeKey), reloadQueue)
    const unsubscribePaused = cacheService.subscribe(pausedKeyFor(scopeKey), reloadPaused)
    reloadQueue()
    reloadPaused()
    return () => {
      unsubscribeQueue()
      unsubscribePaused()
    }
  }, [scopeKey, reconcile])

  const setPaused = useCallback((nextPaused: boolean) => {
    cacheService.setCasual(pausedKeyFor(scopeKeyRef.current), nextPaused)
  }, [])

  const enqueue = useCallback(
    (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => {
      const current = reconcile(loadQueue(scopeKeyRef.current))
      const next = [...current, { id: crypto.randomUUID(), draft, payload }]
      itemsRef.current = next
      setItems(next)
      persist(next)
    },
    [persist, reconcile]
  )

  const removeId = useCallback(
    (id: string) => {
      reconcile(loadQueue(scopeKeyRef.current))
      const index = itemsRef.current.findIndex((item) => item.id === id)
      if (takenRef.current?.item.id === id) takenRef.current = null
      if (index < 0) return
      if (takenRef.current && index < takenRef.current.slot) takenRef.current.slot -= 1
      const next = itemsRef.current.filter((item) => item.id !== id)
      itemsRef.current = next
      setItems(next)
      persist(next)
    },
    [persist, reconcile]
  )

  const reorder = useCallback(
    (nextItems: FollowupQueueItem[]) => {
      const current = reconcile(loadQueue(scopeKeyRef.current))
      const byId = new Map(current.map((item) => [item.id, item]))
      if (nextItems.length !== current.length || new Set(nextItems.map((item) => item.id)).size !== current.length)
        return
      if (!nextItems.every((item) => byId.has(item.id))) return
      const next = nextItems.map((item) => byId.get(item.id)!)
      itemsRef.current = next
      setItems(next)
      persist(next)
    },
    [persist, reconcile]
  )

  const releaseEdit = useCallback(() => {
    takenRef.current = null
  }, [])

  const beginSend = useCallback((id: string) => {
    const scope = scopeKeyRef.current
    const claims = cacheService.getCasual<string[]>(inflightKeyFor(scope)) ?? []
    if (claims.includes(id) || !loadQueue(scope).some((item) => item.id === id)) return null
    cacheService.setCasual(inflightKeyFor(scope), [...claims, id])
    let released = false
    return () => {
      if (released) return
      released = true
      const latest = cacheService.getCasual<string[]>(inflightKeyFor(scope)) ?? []
      cacheService.setCasual(
        inflightKeyFor(scope),
        latest.filter((claim) => claim !== id)
      )
    }
  }, [])

  const takeForEdit = useCallback<FollowupQueueController['takeForEdit']>(
    (id, captureOutgoing) => {
      const current = reconcile(loadQueue(scopeKeyRef.current))
      const claims = cacheService.getCasual<string[]>(inflightKeyFor(scopeKeyRef.current)) ?? []
      if (takenRef.current?.item.id === id || claims.includes(id)) return null
      if (!current.some((item) => item.id === id)) return null
      const taken = takenRef.current
      const next = [...current]
      if (taken) {
        const outgoing = captureOutgoing(taken.item)
        if (!outgoing) return null
        next.splice(Math.min(taken.slot, next.length), 0, { ...taken.item, ...outgoing })
      }
      const slot = next.findIndex((item) => item.id === id)
      const [incoming] = next.splice(slot, 1)
      takenRef.current = { item: incoming, slot }
      itemsRef.current = next
      setItems(next)
      persist(next)
      return incoming
    },
    [persist, reconcile]
  )

  useEffect(() => {
    if (!autoSendEnabled) return
    const flags = classifyTurn(status)
    if (!flags.isTerminal || flags.isTurnActive) return
    const dispatchScope = scopeKeyRef.current
    if (loadPaused(dispatchScope)) return
    const head = loadQueue(dispatchScope)[0]
    if (!head) return
    if (turnId === undefined) {
      cacheService.setCasual(pausedKeyFor(dispatchScope), true)
      onDrainFailedRef.current?.()
      return
    }
    if (cacheService.getCasual<string>(drainedTurnKeyFor(dispatchScope)) === turnId) return
    const release = beginSend(head.id)
    if (!release) return
    cacheService.setCasual(drainedTurnKeyFor(dispatchScope), turnId)
    if (status === 'done') markSeenRef.current()
    const onFailure = onDrainFailedRef.current
    const reportDrainFailure = () => {
      cacheService.setCasual(pausedKeyFor(dispatchScope), true)
      onFailure?.()
    }
    void (async () => {
      try {
        const sent = await onDrainRef.current(head.payload)
        if (sent) {
          const current = loadQueue(dispatchScope)
          if (current.some((item) => item.id === head.id)) {
            cacheService.setCasual(
              keyFor(dispatchScope),
              current.filter((item) => item.id !== head.id),
              QUEUE_TTL
            )
          }
        } else reportDrainFailure()
      } catch {
        reportDrainFailure()
      } finally {
        release()
      }
    })()
  }, [scopeKey, status, turnId, autoSendEnabled, paused, beginSend])

  return { items, enqueue, removeId, reorder, takeForEdit, releaseEdit, beginSend, paused, setPaused }
}
