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
const pausedKeyFor = (scopeKey: string) => `followup-queue-paused.${scopeKey}`
const EMPTY_QUEUE: FollowupQueueItem[] = []

interface CompletionState {
  completedAt: number | undefined
  consumed: boolean
  pendingIds: string[]
}

const EMPTY_COMPLETION: CompletionState = { completedAt: undefined, consumed: false, pendingIds: [] }
const loadCompletion = (scopeKey: string): CompletionState =>
  cacheService.getCasual<CompletionState>(drainedKeyFor(scopeKey)) ?? EMPTY_COMPLETION

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
  /** Called when a send fails and leaves the queued draft paused for retry. */
  onDrainFailed?: () => void
}

export interface FollowupEditOptions {
  /** The composer holds a message edit rather than a queued draft, so nothing is swapped back. */
  editingMessage: boolean
  getDraft: () => ComposerSerializedDraft
  buildPayload: (draft: ComposerSerializedDraft) => ComposerQueuedMessagePayload | null
  hasFiles: boolean
  restore: (item: FollowupQueueItem) => void
}

export interface FollowupQueueController {
  items: FollowupQueueItem[]
  enqueue: (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => void
  sendId: (id: string) => Promise<boolean>
  removeId: (id: string) => void
  reorder: (nextItems: FollowupQueueItem[]) => void
  takeForEdit(
    id: string,
    captureOutgoing: (taken: FollowupQueueItem) => Pick<FollowupQueueItem, 'draft' | 'payload'> | null
  ): FollowupQueueItem | null
  /** Moves a queued item into the composer, returning any draft already taken to its queue slot. */
  editItem(id: string, options: FollowupEditOptions): void
  releaseEdit(): void
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
    () => ({
      scopeKey,
      items: loadQueue(scopeKey),
      paused: loadPaused(scopeKey),
      completion: loadCompletion(scopeKey)
    }),
    [scopeKey]
  )
  const [state, setState] = useState(readState)
  const takenRef = useRef<{
    scopeKey: string
    item: FollowupQueueItem
    slot: number
    precedingIds: string[]
  } | null>(null)
  const onDrainRef = useRef(onDrain)
  onDrainRef.current = onDrain
  const onDrainFailedRef = useRef(onDrainFailed)
  onDrainFailedRef.current = onDrainFailed

  const reconcileEdit = useCallback(
    (items: FollowupQueueItem[]) => {
      const taken = takenRef.current
      if (!taken || taken.scopeKey !== scopeKey) return
      const ids = new Set(items.map((item) => item.id))
      taken.slot -= taken.precedingIds.filter((id) => !ids.has(id)).length
      taken.precedingIds = items.slice(0, taken.slot).map((item) => item.id)
    },
    [scopeKey]
  )

  // The casual cache owns the queue across mounts, including sends finishing after a topic switch.
  useEffect(() => {
    if (takenRef.current?.scopeKey !== scopeKey) takenRef.current = null
    const reload = () => {
      const next = readState()
      reconcileEdit(next.items)
      setState((current) =>
        current.scopeKey === next.scopeKey &&
        current.items === next.items &&
        current.paused === next.paused &&
        current.completion === next.completion
          ? current
          : next
      )
    }
    const unsubscribeQueue = cacheService.subscribe(keyFor(scopeKey), reload)
    const unsubscribePaused = cacheService.subscribe(pausedKeyFor(scopeKey), reload)
    const unsubscribeCompletion = cacheService.subscribe(drainedKeyFor(scopeKey), reload)
    reload()
    return () => {
      unsubscribeQueue()
      unsubscribePaused()
      unsubscribeCompletion()
    }
  }, [readState, reconcileEdit, scopeKey])

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
    (id: string) => {
      if (takenRef.current?.scopeKey === scopeKey && takenRef.current.item.id === id) takenRef.current = null
      const current = loadQueue(scopeKey)
      if (current.some((item) => item.id === id)) persist(current.filter((item) => item.id !== id))
    },
    [persist, scopeKey]
  )

  const releaseEdit = useCallback(() => {
    if (takenRef.current?.scopeKey === scopeKey) takenRef.current = null
  }, [scopeKey])

  const takeForEdit = useCallback<FollowupQueueController['takeForEdit']>(
    (id, captureOutgoing) => {
      const current = loadQueue(scopeKey)
      reconcileEdit(current)
      const taken = takenRef.current?.scopeKey === scopeKey ? takenRef.current : null
      if (taken?.item.id === id || loadCompletion(scopeKey).pendingIds.includes(id)) return null
      if (!current.some((item) => item.id === id)) return null
      const next = [...current]
      if (taken) {
        const outgoing = captureOutgoing(taken.item)
        if (!outgoing) return null
        next.splice(Math.min(taken.slot, next.length), 0, { ...taken.item, ...outgoing })
      }
      const slot = next.findIndex((item) => item.id === id)
      const [incoming] = next.splice(slot, 1)
      takenRef.current = { scopeKey, item: incoming, slot, precedingIds: next.slice(0, slot).map((item) => item.id) }
      persist(next)
      return incoming
    },
    [persist, reconcileEdit, scopeKey]
  )

  const editItem = useCallback<FollowupQueueController['editItem']>(
    (id, { editingMessage, getDraft, buildPayload, hasFiles, restore }) => {
      if (editingMessage) {
        releaseEdit()
        const item = loadQueue(scopeKey).find((entry) => entry.id === id)
        if (!item) return
        restore(item)
        removeId(id)
        return
      }
      const incoming = takeForEdit(id, (taken) => {
        const draft = getDraft()
        const payload = buildPayload(draft)
        if (payload) return { draft, payload: { ...payload, chatTarget: taken.payload.chatTarget } }
        return !draft.text.trim() && !hasFiles ? { draft: taken.draft, payload: taken.payload } : null
      })
      if (incoming) restore(incoming)
    },
    [releaseEdit, removeId, scopeKey, takeForEdit]
  )

  const sendItem = useCallback(
    async (id: string, completedAt?: number): Promise<boolean> => {
      const item = loadQueue(scopeKey).find((entry) => entry.id === id)
      const drained = loadCompletion(scopeKey)
      if (!item || drained.pendingIds.includes(id)) return false

      // Every send owns its dispatch-time completion, including peers on the same completed turn.
      // Keep item exclusion and pending sends in one observable record, without an in-flight TTL.
      cacheService.setCasual(drainedKeyFor(scopeKey), {
        completedAt: completedAt ?? drained.completedAt,
        consumed: completedAt == null || completedAt === drained.completedAt ? drained.consumed : false,
        pendingIds: [...drained.pendingIds, id]
      })
      const reportFailure = onDrainFailedRef.current
      let sent = false
      try {
        try {
          sent = await onDrainRef.current(item.payload)
        } catch {
          // Both rejected sends and explicit failures retain the draft for retry.
        }
        if (sent) {
          removeId(id)
        } else {
          setPaused(true)
          reportFailure?.()
        }
        return sent
      } finally {
        const current = loadCompletion(scopeKey)
        const pendingIds = current.pendingIds.filter((pendingId) => pendingId !== id)
        // A failure cannot undo a successful peer, and an older send cannot consume a newer turn.
        // Publish settlement even when the queue write was suppressed because the item was removed.
        cacheService.setCasual(
          drainedKeyFor(scopeKey),
          {
            completedAt: current.completedAt,
            consumed: current.consumed || (sent && completedAt != null && current.completedAt === completedAt),
            pendingIds
          },
          pendingIds.length > 0 ? undefined : QUEUE_TTL
        )
      }
    },
    [scopeKey, removeId, setPaused]
  )
  const sendId = useCallback(
    (id: string) => sendItem(id, status === 'done' ? (lastCompletedAt ?? undefined) : undefined),
    [sendItem, status, lastCompletedAt]
  )

  useEffect(() => {
    if (state.scopeKey !== scopeKey || state.paused || status !== 'done' || lastCompletedAt == null) return
    const head = state.items[0]
    const drained = loadCompletion(scopeKey)
    if (!head || drained.pendingIds.length > 0 || (drained.consumed && drained.completedAt === lastCompletedAt)) return
    void sendItem(head.id, lastCompletedAt)
  }, [scopeKey, status, lastCompletedAt, state, sendItem])

  return {
    items: state.items,
    enqueue,
    sendId,
    removeId,
    reorder: persist,
    takeForEdit,
    editItem,
    releaseEdit,
    paused: state.paused,
    setPaused
  }
}
