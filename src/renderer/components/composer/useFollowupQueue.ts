import { useCallback, useEffect, useRef, useState } from 'react'

import { cacheService } from '@data/CacheService'
import { isComposerTokenKind } from '@renderer/utils/composerTokenPolicy'
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
export const QUEUE_LIMIT = 20
const failedKeyFor = (scopeKey: string) => `followup-queue-failed.${scopeKey}`
const EMPTY_QUEUE: FollowupQueueItem[] = []

interface CompletionState {
  completedAt: number | undefined
  consumed: boolean
  pendingIds: string[]
}

const EMPTY_COMPLETION: CompletionState = { completedAt: undefined, consumed: false, pendingIds: [] }
const loadCompletion = (scopeKey: string): CompletionState => {
  const value = cacheService.getCasual<CompletionState>(drainedKeyFor(scopeKey))
  return value && Array.isArray(value.pendingIds) ? value : EMPTY_COMPLETION
}

/** Cache validation snapshots to keep filtered arrays stable across renders. */
class FollowupQueueValidationService {
  private readonly snapshots = new WeakMap<object, FollowupQueueItem[]>()
  read(value: unknown): FollowupQueueItem[] {
    if (!Array.isArray(value)) return EMPTY_QUEUE
    const known = this.snapshots.get(value)
    if (known) return known
    const items = value.filter((item) => {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) return false
      const candidate = item as { id?: unknown; draft?: unknown; payload?: unknown }
      if (typeof candidate.id !== 'string' || candidate.id.length === 0) return false
      if (candidate.payload == null || typeof candidate.payload !== 'object') return false
      // The dock preview + edit-restore assume the draft shape (`tokens.some`,
      // `text.trim` throw otherwise), so entries with a misshapen draft go too.
      const draft = candidate.draft as { text?: unknown; tokens?: unknown } | null
      if (
        draft === null ||
        typeof draft !== 'object' ||
        Array.isArray(draft) ||
        typeof draft.text !== 'string' ||
        !Array.isArray(draft.tokens)
      )
        return false
      // Null token elements throw on `.kind` access in the dock filter, and the
      // edit-restore path maps `mentionedModels` / reads message parts — non-array
      // shapes there throw or corrupt the restore, so reject them as well. Token
      // objects additionally need a string id (the skill restore reads
      // `token.id.startsWith`, React uses it as the chip key), a known kind (the
      // dock renders via a per-kind component map with no fallback, so an
      // unknown kind crashes), and a string label (rendered as a React child).
      // Optional display fields must be strings when present — the token views
      // read them as tooltip/aria text.
      const isOptionalString = (value: unknown): boolean => value == null || typeof value === 'string'
      if (
        draft.tokens.some((token) => {
          if (token == null || typeof token !== 'object' || Array.isArray(token)) return true
          const record = token as {
            id?: unknown
            kind?: unknown
            label?: unknown
            icon?: unknown
            description?: unknown
            promptText?: unknown
          }
          return (
            typeof record.id !== 'string' ||
            !isComposerTokenKind(record.kind) ||
            typeof record.label !== 'string' ||
            !isOptionalString(record.icon) ||
            !isOptionalString(record.description) ||
            !isOptionalString(record.promptText)
          )
        })
      )
        return false
      const queuePayload = candidate.payload as {
        text?: unknown
        attachments?: unknown
        userMessageParts?: unknown
        mentionedModels?: unknown
      }
      // Null elements throw on property access downstream (`part.type` in the
      // knowledge-base extractor, `attachment.path` in file-part building), and
      // a text part without string text throws in history-text extraction.
      // Attachments additionally need a non-empty string path: the send path
      // throws for missing or empty paths before the first IPC, so such an
      // entry could never send and would only fail visibly on every drain.
      const isObjectList = (value: unknown): value is object[] =>
        Array.isArray(value) &&
        value.every((element) => element !== null && typeof element === 'object' && !Array.isArray(element))
      const isAttachmentList = (value: unknown): value is object[] =>
        isObjectList(value) &&
        value.every((element) => {
          const path = (element as { path?: unknown }).path
          return typeof path === 'string' && path.length > 0
        })
      const isPartList = (value: unknown): value is object[] =>
        isObjectList(value) &&
        value.every((element) => {
          const part = element as { type?: unknown; text?: unknown }
          return typeof part.type === 'string' && (part.type !== 'text' || typeof part.text === 'string')
        })
      // `text` is required by ComposerQueuedMessagePayload (the builder always
      // sets it, `''` for attachment-only sends); the send path hands it to
      // onSend untouched. `userMessageParts` is likewise always an array from
      // the builder, and both send (`[...parts]` spread) and edit restoration
      // (`part.type` reads) assume it.
      if (typeof queuePayload.text !== 'string') return false
      if (!isPartList(queuePayload.userMessageParts)) return false
      return (
        (queuePayload.attachments == null || isAttachmentList(queuePayload.attachments)) &&
        (queuePayload.mentionedModels == null || Array.isArray(queuePayload.mentionedModels))
      )
    }) as FollowupQueueItem[]
    const stable = items.length === value.length ? value : items
    this.snapshots.set(value, stable)
    return stable
  }
}
const followupQueueValidationService = new FollowupQueueValidationService()
function loadQueue(scopeKey: string): FollowupQueueItem[] {
  return followupQueueValidationService.read(cacheService.getCasual(keyFor(scopeKey)))
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
  enqueue: (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => 'ok' | 'full'
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
  clear: () => void
  failedItemId: string | null
  retryFailed: () => void
  skipFailed: () => void
  drainingId: string | null
  hasLiveSend: () => boolean
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
      failedItemId: cacheService.getCasual<string>(failedKeyFor(scopeKey)) ?? null,
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
        current.failedItemId === next.failedItemId &&
        current.completion === next.completion
          ? current
          : next
      )
    }
    const unsubscribeQueue = cacheService.subscribe(keyFor(scopeKey), reload)
    const unsubscribePaused = cacheService.subscribe(pausedKeyFor(scopeKey), reload)
    const unsubscribeCompletion = cacheService.subscribe(drainedKeyFor(scopeKey), reload)
    const unsubscribeFailed = cacheService.subscribe(failedKeyFor(scopeKey), reload)
    reload()
    return () => {
      unsubscribeFailed()
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
      const current = loadQueue(scopeKey)
      if (current.length >= QUEUE_LIMIT) return 'full'
      persist([...current, { id: crypto.randomUUID(), draft, payload }])
      return 'ok' as const
    },
    [persist, scopeKey]
  )
  const removeId = useCallback(
    (id: string) => {
      if (takenRef.current?.scopeKey === scopeKey && takenRef.current.item.id === id) takenRef.current = null
      const current = loadQueue(scopeKey)
      if (current.some((item) => item.id === id)) persist(current.filter((item) => item.id !== id))
      if (cacheService.getCasual(failedKeyFor(scopeKey)) === id) {
        cacheService.setCasual(failedKeyFor(scopeKey), null)
        setPaused(false)
      }
    },
    [persist, scopeKey, setPaused]
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
      if (incoming) {
        if (cacheService.getCasual(failedKeyFor(scopeKey)) === incoming.id) {
          cacheService.setCasual(failedKeyFor(scopeKey), null)
          setPaused(false)
        }
        restore(incoming)
      }
    },
    [releaseEdit, removeId, scopeKey, takeForEdit, setPaused]
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
        } else if (loadQueue(scopeKey).some((entry) => entry.id === id)) {
          // A removed pending row has no draft to retry. Settlement below still
          // notifies the owner so its deferred completion can drain the next head.
          cacheService.setCasual(failedKeyFor(scopeKey), id, QUEUE_TTL)
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
    clear: () => {
      persist([])
      cacheService.setCasual(failedKeyFor(scopeKey), null)
      setPaused(false)
      releaseEdit()
    },
    failedItemId: state.failedItemId,
    retryFailed: () => {
      const id = cacheService.getCasual<string>(failedKeyFor(scopeKey))
      if (!id || loadCompletion(scopeKey).pendingIds.includes(id)) return
      void sendId(id).then((sent) => {
        if (sent) {
          cacheService.setCasual(failedKeyFor(scopeKey), null)
          setPaused(false)
        }
      })
    },
    skipFailed: () => {
      const id = cacheService.getCasual<string>(failedKeyFor(scopeKey))
      if (!id || loadCompletion(scopeKey).pendingIds.includes(id)) return
      removeId(id)
      const next = loadQueue(scopeKey)[0]
      if (next) void sendId(next.id)
    },
    drainingId: state.completion.pendingIds[0] ?? null,
    hasLiveSend: () => loadCompletion(scopeKey).pendingIds.length > 0,
    enqueue,
    sendId,
    removeId,
    reorder: (next) => {
      const ids = new Set(loadQueue(scopeKey).map((item) => item.id))
      persist(next.filter((item) => ids.has(item.id)))
    },
    takeForEdit,
    editItem,
    releaseEdit,
    paused: state.paused,
    setPaused
  }
}
