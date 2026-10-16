import { useCallback, useEffect, useRef, useState } from 'react'

import { cacheService } from '@data/CacheService'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'

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
const pausedKeyFor = (scopeKey: string) => `followup-queue-paused.${scopeKey}`
const editKeyFor = (scopeKey: string) => `followup-queue-edit.${scopeKey}`

interface FollowupQueueEdit {
  item: FollowupQueueItem
  index: number
}

/** Load + validate a persisted queue (the cache holds arbitrary JSON; guard non-array entries). */
function loadQueue(scopeKey: string): FollowupQueueItem[] {
  const cached = cacheService.getCasual<FollowupQueueItem[]>(keyFor(scopeKey))
  return Array.isArray(cached) ? cached : []
}

function loadPaused(scopeKey: string): boolean {
  return cacheService.getCasual<boolean>(pausedKeyFor(scopeKey)) === true
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
  enqueue: (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => void
  removeId: (id: string) => void
  takeForEdit: (id: string) => FollowupQueueItem | undefined
  completeEdit: () => void
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
  isFulfilled,
  markSeen,
  onDrain,
  onDrainFailed
}: UseFollowupQueueParams): FollowupQueueController {
  const [items, setItems] = useState<FollowupQueueItem[]>(() => loadQueue(scopeKey))
  const [paused, setPausedState] = useState(() => loadPaused(scopeKey))

  // Latest values for the persistence + drain closures (kept off the effect deps to avoid re-running).
  const scopeKeyRef = useRef(scopeKey)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const onDrainRef = useRef(onDrain)
  onDrainRef.current = onDrain
  const onDrainFailedRef = useRef(onDrainFailed)
  onDrainFailedRef.current = onDrainFailed

  const updateItems = useCallback((next: FollowupQueueItem[]) => {
    itemsRef.current = next
    cacheService.setCasual(keyFor(scopeKeyRef.current), next, QUEUE_TTL)
    setItems(next)
  }, [])

  // Reload when switching conversations; the previous queue stays in its own scoped cache entry.
  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return
    scopeKeyRef.current = scopeKey
    setItems(loadQueue(scopeKey))
    setPausedState(loadPaused(scopeKey))
  }, [scopeKey])

  const setPaused = useCallback((nextPaused: boolean) => {
    cacheService.setCasual(pausedKeyFor(scopeKeyRef.current), nextPaused)
    setPausedState(nextPaused)
  }, [])

  const completeEdit = useCallback(() => {
    cacheService.deleteCasual(editKeyFor(scopeKey))
  }, [scopeKey])

  const takeForEdit = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((entry) => entry.id === id)
      if (!item) return undefined
      const editKey = editKeyFor(scopeKeyRef.current)
      const previous = cacheService.getCasual<FollowupQueueEdit>(editKey)
      const next = [...itemsRef.current]
      if (previous) next.splice(previous.index, 0, previous.item)
      const index = next.findIndex((entry) => entry.id === id)
      next.splice(index, 1)
      // Keep the original snapshot until submission so switching edits cancels without losing the queued turn.
      cacheService.setCasual(editKey, { item, index } satisfies FollowupQueueEdit, QUEUE_TTL)
      updateItems(next)
      return item
    },
    [updateItems]
  )

  const enqueue = useCallback(
    (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => {
      completeEdit()
      updateItems([...itemsRef.current, { id: crypto.randomUUID(), draft, payload }])
    },
    [completeEdit, updateItems]
  )

  const removeId = useCallback(
    (id: string) => {
      const index = itemsRef.current.findIndex((item) => item.id === id)
      const editKey = editKeyFor(scopeKeyRef.current)
      const editing = cacheService.getCasual<FollowupQueueEdit>(editKey)
      if (editing && index >= 0 && index < editing.index) {
        cacheService.setCasual(editKey, { ...editing, index: editing.index - 1 }, QUEUE_TTL)
      }
      updateItems(itemsRef.current.filter((item) => item.id !== id))
    },
    [updateItems]
  )

  // Drain one message per completion: on the live→idle edge, acknowledge it (so it fires once) and
  // send the head; on success dequeue. The next send goes busy→idle again and drains the next item.
  useEffect(() => {
    if (!isFulfilled || paused) return
    const head = itemsRef.current[0]
    if (!head) return
    markSeen()
    const reportDrainFailure = () => onDrainFailedRef.current?.()
    void onDrainRef.current(head.payload).then((sent) => {
      if (sent) removeId(head.id)
      else reportDrainFailure()
    }, reportDrainFailure)
  }, [isFulfilled, paused, markSeen, removeId])

  return { items, enqueue, removeId, takeForEdit, completeEdit, reorder: updateItems, paused, setPaused }
}
