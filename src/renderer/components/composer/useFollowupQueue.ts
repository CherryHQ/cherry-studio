import { useCallback, useEffect, useRef, useState } from 'react'

import { cacheService } from '@data/CacheService'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'

import type { ComposerSerializedDraft } from './tokens'

export const QUEUE_LIMIT = 20

/** Renderer composer-domain queue model (per-window memory cache entry, revalidated on load). */
export interface FollowupQueueItem {
  id: string
  /** Serialized draft (text + tokens) — drives the dock preview and edit-restore. */
  draft: ComposerSerializedDraft
  /** Send-ready payload (text + parts + files/models) captured at enqueue time. */
  payload: ComposerQueuedMessagePayload
}

export interface FollowupQueueState {
  items: FollowupQueueItem[]
  paused: boolean
  failedItemId?: string | null
  /**
   * Head id with a send still pending. Durable (unlike drainingId/inflight) so a
   * remounted hook instance can tell "another instance's send owns this head" apart
   * from "free to drain" — the claim holder clears it on settle.
   */
  pendingDrainId?: string | null
}

/** Same per-window memory tier + TTL as the inputbar draft cache (`composerDraft` / ChatComposer). */
const QUEUE_TTL = 24 * 60 * 60 * 1000
const keyFor = (scopeKey: string) => `followup-queue.${scopeKey}`

/** Load + validate a queued state (the cache holds arbitrary values; discard malformed entries). */
function loadState(scopeKey: string): FollowupQueueState {
  try {
    const cached = cacheService.getCasual<FollowupQueueState>(keyFor(scopeKey))
    if (!cached || typeof cached !== 'object' || Array.isArray(cached)) return { items: [], paused: false }
    const items = Array.isArray(cached.items)
      ? (cached.items as unknown[]).filter((item) => {
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
          // objects additionally need a string id: the skill restore reads
          // `token.id.startsWith`, and React uses it as the chip key.
          if (
            draft.tokens.some(
              (token) =>
                token == null ||
                typeof token !== 'object' ||
                Array.isArray(token) ||
                typeof (token as { id?: unknown }).id !== 'string'
            )
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
          // Attachments additionally need a string path: the send path throws for
          // pathless attachments before the first IPC, so such an entry could never
          // send and would only fail visibly on every drain.
          const isObjectList = (value: unknown): value is object[] =>
            Array.isArray(value) &&
            value.every((element) => element !== null && typeof element === 'object' && !Array.isArray(element))
          const isAttachmentList = (value: unknown): value is object[] =>
            isObjectList(value) && value.every((element) => typeof (element as { path?: unknown }).path === 'string')
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
        })
      : []
    const failedItemId =
      typeof cached.failedItemId === 'string' &&
      items.some((entry) => (entry as { id?: unknown }).id === cached.failedItemId)
        ? cached.failedItemId
        : undefined
    // A claim is meaningful only while its send is live (see liveSends); a dangling
    // marker names no queued item but still blocks other heads until the removed
    // send settles, so it is kept here and validated at each drain decision.
    const pendingDrainId = typeof cached.pendingDrainId === 'string' ? cached.pendingDrainId : undefined
    return {
      items: items as unknown as FollowupQueueItem[],
      paused: cached.paused === true,
      failedItemId,
      pendingDrainId
    }
  } catch {
    return { items: [], paused: false }
  }
}

/** Sends with a promise still pending anywhere in this page, by head id. Module-level
 * so remounted hook instances can see another instance's live send; dies on restart,
 * which is exactly when pending sends die too. */
const liveSends = new Set<string>()

type ScopeListener = () => void
const scopeListeners = new Map<string, Set<ScopeListener>>()

function notifyScope(scopeKey: string): void {
  const listeners = scopeListeners.get(scopeKey)
  if (!listeners) return
  for (const listener of [...listeners]) listener()
}

function subscribeScope(scopeKey: string, listener: ScopeListener): () => void {
  let set = scopeListeners.get(scopeKey)
  if (!set) {
    set = new Set()
    scopeListeners.set(scopeKey, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) scopeListeners.delete(scopeKey)
  }
}

function persistState(
  scopeKey: string,
  items: FollowupQueueItem[],
  paused: boolean,
  failedItemId?: string | null,
  pendingDrainId?: string | null
): void {
  const next: FollowupQueueState = {
    items,
    paused,
    ...(failedItemId ? { failedItemId } : {}),
    ...(pendingDrainId ? { pendingDrainId } : {})
  }
  cacheService.setCasual(keyFor(scopeKey), next, QUEUE_TTL)
  notifyScope(scopeKey)
}

/**
 * Drop an id from one scope's persisted entry without touching live hook state.
 * Used when an in-flight send settles after its hook moved on (scope switch /
 * unmount): a success must still dequeue from the scope it was sent for, or the
 * sent item is redelivered later as a duplicate.
 */ function removeIdFromScope(targetScope: string, id: string): void {
  const entry = loadState(targetScope)
  const hasId = entry.items.some((item) => item.id === id)
  // A claim for the removed head goes with it — unless it is live, in which case
  // a newer send owns it and only its settle may release it.
  const clearsMarker = entry.pendingDrainId === id && !liveSends.has(id)
  if (!hasId && !clearsMarker && entry.failedItemId !== id) return
  const failedResolved = entry.failedItemId === id
  persistState(
    targetScope,
    entry.items.filter((item) => item.id !== id),
    failedResolved ? false : entry.paused,
    failedResolved ? null : (entry.failedItemId ?? null),
    clearsMarker ? null : (entry.pendingDrainId ?? null)
  )
}

/**
 * Release one scope's durable send-claim without dequeuing anything. Never touches
 * a live marker: that claim belongs to a newer send whose settle owns the outcome.
 */
function clearPendingInScope(targetScope: string, id: string): void {
  const entry = loadState(targetScope)
  if (entry.pendingDrainId !== id || liveSends.has(id)) return
  persistState(targetScope, entry.items, entry.paused, entry.failedItemId ?? null, null)
}

/**
 * Record an honest failure for a head whose send settled after its hook moved on.
 * Only applies when the head is still queued in that scope (a removed head stays
 * removed); subscribers reload the banner instead of stalling silently.
 */
function writeFailureToScope(targetScope: string, id: string): void {
  const entry = loadState(targetScope)
  // A live marker means a newer send for this head is still pending: it owns the
  // outcome, so a stale failure must not pause the queue or steal its claim.
  if (entry.pendingDrainId === id && liveSends.has(id)) return
  if (!entry.items.some((item) => item.id === id)) {
    clearPendingInScope(targetScope, id)
    return
  }
  persistState(targetScope, entry.items, true, id, null)
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

export type EnqueueResult = 'ok' | 'full'

export interface FollowupQueueController {
  items: FollowupQueueItem[]
  /**
   * Queue a follow-up: `ok` when queued, `full` when the per-conversation limit rejected it.
   * Only `ok` means the caller may clear the draft.
   */
  enqueue: (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload) => EnqueueResult
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
  /** Id of the item currently being sent (auto-drain or claimed manual steer), if any. */
  drainingId: string | null
  /**
   * Claim the shared send slot for a manual steer. Returns false when another
   * send is already in flight — the caller must not send. A held claim blocks
   * the auto-drain paths until `releaseSend` (or a successful `removeId`).
   */
  tryClaimSend: (id: string) => boolean
  /** Release a claim taken by `tryClaimSend` (no-op when it is not the holder). */
  releaseSend: (id: string) => void
}

/**
 * Per-conversation FIFO queue of follow-up drafts. While a turn streams the composer enqueues here
 * instead of sending; on the live→idle edge the head auto-drains (one per completion), and the dock
 * lets the user steer/edit/remove individual items, pause auto-drain, or clear the queue. A failed
 * drain auto-pauses and marks the head as failed for the user to Skip / Retry / Abort. Persistence
 * mirrors the draft cache (per-window memory + TTL).
 */
export function useFollowupQueue({
  scopeKey,
  isFulfilled,
  markSeen,
  onDrain
}: UseFollowupQueueParams): FollowupQueueController {
  const initial = loadState(scopeKey)
  const [state, setState] = useState<FollowupQueueState>(() => ({ items: initial.items, paused: initial.paused }))
  const [failedItemId, setFailedItemId] = useState<string | null>(() => initial.failedItemId ?? null)

  // Serialize drains: only one send may be in flight per queue at a time.
  const drainingIdRef = useRef<string | null>(null)
  // Bumped whenever queue mutations invalidate an in-flight drain's resolution (clear / removing
  // the drained item / scope switch), so a settled drain cannot resurrect state for a dropped item.
  const drainEpochRef = useRef(0)
  // Latest started send; lets a stale settlement tell "superseded by a replacement
  // send for the same head" apart from "the queue moved on".
  const drainSeqRef = useRef(0)
  const lastDrainRef = useRef<{ id: string; seq: number } | null>(null)
  // Sends with a promise still pending (cleared on settle). Same-instance guard so a
  // scope-switch re-arm, resume, or manual steer cannot start a second send for a
  // payload whose original send has not finished yet (rapid away-and-back switches).
  const inflightRef = useRef(new Map<string, number>())
  // False once unmounted: a late settle must then only touch the persisted entry,
  // never live refs a remounted hook may have replaced.
  const mountedRef = useRef(true)
  // Reactive mirror of drainingIdRef so composers can disable the steered row's button.
  const [drainingId, setDrainingId] = useState<string | null>(null)
  const setDraining = useCallback((id: string | null) => {
    drainingIdRef.current = id
    setDrainingId(id)
  }, [])

  // Latest values for the persistence + drain closures (kept off the effect deps to avoid re-running).
  const scopeKeyRef = useRef(scopeKey)
  const stateRef = useRef(state)
  stateRef.current = state
  const failedItemIdRef = useRef(failedItemId)
  failedItemIdRef.current = failedItemId
  // Durable send-claim mirror (see FollowupQueueState.pendingDrainId): carried into
  // every persist so unrelated mutations never drop another instance's claim, and
  // dropped whenever the claimed id leaves the queue.
  const pendingDrainIdRef = useRef<string | null>(initial.pendingDrainId ?? null)
  const onDrainRef = useRef(onDrain)
  onDrainRef.current = onDrain
  const isFulfilledRef = useRef(isFulfilled)
  isFulfilledRef.current = isFulfilled
  const markSeenRef = useRef(markSeen)
  markSeenRef.current = markSeen

  const persist = useCallback((next: FollowupQueueState, failedId?: string | null) => {
    const fid = failedId !== undefined ? failedId : failedItemIdRef.current
    // The durable claim survives even when its head left the queue (removed head's
    // send still pending): drains stay serialized until that send settles and the
    // stale path releases the marker. Prefer this instance's own claim, but never
    // drop another instance's live claim with an unrelated write.
    const own = pendingDrainIdRef.current
    const liveMarker = loadState(scopeKeyRef.current).pendingDrainId ?? null
    const pending = own ?? (liveMarker && liveSends.has(liveMarker) ? liveMarker : null)
    persistState(scopeKeyRef.current, next.items, next.paused, fid, pending)
  }, [])

  // Mark the head as failed and auto-pause; the user resolves it via the dock (Skip/Retry/Abort).
  const failHead = useCallback(
    (id: string) => {
      const next = { ...stateRef.current, paused: true }
      persist(next, id)
      stateRef.current = next
      failedItemIdRef.current = id
      setFailedItemId(id)
      setState(next)
    },
    [persist]
  )
  const failHeadRef = useRef(failHead)
  failHeadRef.current = failHead

  // Manual-steer claims by head id (id -> the scope each claim was taken in). Per-send
  // records (not one shared slot): a second steer after a scope switch must not
  // strand the first claim's scope, or its cleanup dequeues from the wrong entry.
  // Read by removeId/releaseSend below.
  const manualClaimsRef = useRef(new Map<string, string>())

  const removeIdRef = useRef<(id: string) => void>(() => {})

  // Resolution for a send whose queue moved on before it settled (scope switch /
  // clear / removal / unmount). Never disturbs a replacement send for the same head.
  const settleStale = useCallback(
    (head: FollowupQueueItem, drainScope: string, seq: number, outcome: 'sent' | 'unsent') => {
      const last = lastDrainRef.current
      // A replacement send for the same head started after us: it owns the claim
      // and the entry — its own settle applies the outcome, so leave both alone.
      // (A newer send for a *different* head changes nothing about ours: entry
      // helpers below stay scoped to our id, and the live-claim guards are too.)
      if (last !== null && last.id === head.id && last.seq !== seq) return
      const liveHasHead =
        mountedRef.current &&
        drainScope === scopeKeyRef.current &&
        stateRef.current.items.some((item) => item.id === head.id)
      if (outcome === 'sent') {
        if (liveHasHead) {
          // Back on (or never left) the sent scope with the same head live:
          // dequeue it so the sent payload can never be redelivered.
          if (mountedRef.current && drainingIdRef.current === head.id) setDraining(null)
          removeIdRef.current(head.id)
        } else {
          removeIdFromScope(drainScope, head.id)
          if (mountedRef.current && drainingIdRef.current === head.id) setDraining(null)
        }
      } else if (liveHasHead) {
        // Nothing was sent and the head is still live: record the honest failure.
        if (mountedRef.current && drainingIdRef.current === head.id) setDraining(null)
        failHeadRef.current(head.id)
      } else {
        // Nothing was sent and the head isn't live here: a queued head gets an
        // honest persisted failure (subscribers reload the banner instead of
        // stalling silently); a removed head just releases its durable claim.
        writeFailureToScope(drainScope, head.id)
        if (mountedRef.current && drainingIdRef.current === head.id) setDraining(null)
      }
    },
    [setDraining]
  )

  const drainHead = useCallback(
    (head: FollowupQueueItem | undefined) => {
      if (!head || drainingIdRef.current !== null || inflightRef.current.has(head.id)) return
      const liveScope = scopeKeyRef.current
      const entry = loadState(liveScope)
      // The persisted entry is the durability record across remounts: a previous hook
      // instance may have settled (and dequeued) this head after unmounting. Sending
      // a head the entry no longer holds would redeliver an already-sent payload,
      // so sync live state instead and don't send.
      if (!entry.items.some((item) => item.id === head.id)) {
        removeIdRef.current(head.id)
        return
      }
      const marker = entry.pendingDrainId ?? null
      // A live claim — ours tracked above, another instance's here — owns this head
      // until it settles; starting our own would submit the payload twice. A live
      // claim for a removed head likewise blocks the next item until that send
      // settles, keeping one send in flight per queue.
      if (marker && liveSends.has(marker)) return
      if (marker) clearPendingInScope(liveScope, marker)
      setDraining(head.id)
      // Durably claim the head so a remounted instance won't send it concurrently.
      // Register liveness before persisting the marker (matching tryClaimSend), so
      // subscriber notifications observing the entry mid-claim see a live owner.
      pendingDrainIdRef.current = head.id
      liveSends.add(head.id)
      persist(stateRef.current)
      const epoch = drainEpochRef.current
      const drainScope = scopeKeyRef.current
      const seq = (drainSeqRef.current += 1)
      lastDrainRef.current = { id: head.id, seq }
      inflightRef.current.set(head.id, seq)
      const settleInflight = () => {
        if (inflightRef.current.get(head.id) === seq) inflightRef.current.delete(head.id)
        liveSends.delete(head.id)
      }
      // Only this send may release the ref mirror: a newer send for another scope
      // reuses the same ref, and a blind clear would drop its durable claim.
      const releasePendingRef = () => {
        if (pendingDrainIdRef.current === head.id) pendingDrainIdRef.current = null
      }
      void onDrainRef.current(head.payload).then(
        (sent) => {
          settleInflight()
          releasePendingRef()
          if (drainEpochRef.current !== epoch) {
            settleStale(head, drainScope, seq, sent ? 'sent' : 'unsent')
            return
          }
          setDraining(null)
          if (sent) removeIdRef.current(head.id)
          else failHeadRef.current(head.id)
        },
        () => {
          settleInflight()
          releasePendingRef()
          if (drainEpochRef.current !== epoch) {
            settleStale(head, drainScope, seq, 'unsent')
            return
          }
          setDraining(null)
          failHeadRef.current(head.id)
        }
      )
    },
    [persist, setDraining, settleStale]
  )

  // Reload live state from the persisted entry (cross-instance sync). The entry is
  // the source of truth — every mutation persists synchronously — so converging
  // to it can only drop state another instance already settled. Never touches the
  // live send claim, which belongs to this instance's in-flight sends.
  const syncFromEntry = useCallback(() => {
    const scope = scopeKeyRef.current
    const next = loadState(scope)
    stateRef.current = { items: next.items, paused: next.paused }
    failedItemIdRef.current = next.failedItemId ?? null
    pendingDrainIdRef.current = next.pendingDrainId ?? null
    setFailedItemId(next.failedItemId ?? null)
    setState({ items: next.items, paused: next.paused })
  }, [])

  // Cross-instance sync + dead-claim reconcile for the active scope. A marker whose
  // send is no longer live anywhere in this page (crashed owner) would otherwise
  // block the head forever — and there is nothing left that could clear it.
  // Uses the scopeKey prop (not the ref, which the switch effect below may not
  // have updated yet — effects run in declaration order, so this one runs first
  // and would otherwise stay subscribed to the previous conversation).
  useEffect(() => {
    const entry = loadState(scopeKey)
    if (entry.pendingDrainId && !liveSends.has(entry.pendingDrainId)) {
      clearPendingInScope(scopeKey, entry.pendingDrainId)
    }
    return subscribeScope(scopeKey, () => {
      if (mountedRef.current) syncFromEntry()
    })
  }, [scopeKey, syncFromEntry])

  // A late-settling send must not apply to whatever a remounted hook loads next.
  useEffect(() => {
    return () => {
      mountedRef.current = false
      drainEpochRef.current += 1
    }
  }, [])

  // Reload when switching conversations; the previous queue stays in its own scoped cache entry.
  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return
    scopeKeyRef.current = scopeKey
    // A drain in flight for the previous scope must not settle into the new scope's queue.
    drainEpochRef.current += 1
    setDraining(null)
    const next = loadState(scopeKey)
    // Sync the ref before React commits the new state — otherwise the drain effect
    // running in the same commit would still see the previous conversation's items
    // and could drain the old head through the new conversation's completion edge.
    stateRef.current = { items: next.items, paused: next.paused }
    failedItemIdRef.current = next.failedItemId ?? null
    pendingDrainIdRef.current = next.pendingDrainId ?? null
    setState({ items: next.items, paused: next.paused })
    setFailedItemId(next.failedItemId ?? null)
    // If the restored queue is non-empty and completion is already fulfilled, re-arm
    // draining immediately — the isFulfilled effect won't re-fire since its dep hasn't changed.
    if (next.items.length > 0 && !next.paused && !next.failedItemId && isFulfilledRef.current) {
      markSeenRef.current()
      // Defer to next tick so state has committed before drainHead checks drainingIdRef.
      // Re-read head inside the microtask so a rapid second scope switch does not
      // drain a stale head through the new conversation's completion edge.
      const targetScope = scopeKey
      queueMicrotask(() => {
        if (!mountedRef.current) return
        if (scopeKeyRef.current !== targetScope) return
        if (!isFulfilledRef.current) return
        if (failedItemIdRef.current || drainingIdRef.current !== null) return
        if (stateRef.current.paused) return
        const currentHead = stateRef.current.items[0]
        // Skip a head whose original send is still pending (rapid away-and-back):
        // its settle applies the outcome to this same live queue — starting
        // another send now would submit the payload twice.
        if (currentHead && !inflightRef.current.has(currentHead.id)) drainHead(currentHead)
      })
    }
  }, [scopeKey, drainHead, setDraining])

  const enqueue = useCallback(
    (draft: ComposerSerializedDraft, payload: ComposerQueuedMessagePayload): EnqueueResult => {
      if (stateRef.current.items.length >= QUEUE_LIMIT) return 'full'
      const newItem: FollowupQueueItem = { id: crypto.randomUUID(), draft, payload }
      const next = { items: [...stateRef.current.items, newItem], paused: stateRef.current.paused }
      persist(next)
      stateRef.current = next
      setState(next)
      return 'ok'
    },
    [persist]
  )

  const reorder = useCallback(
    (nextItems: FollowupQueueItem[]) => {
      const nextIds = new Set(nextItems.map((i) => i.id))
      if (drainingIdRef.current && !nextIds.has(drainingIdRef.current)) {
        // Same as removeId: invalidate the in-flight resolution but keep the send
        // claim held until it settles, so the next item cannot start concurrently.
        drainEpochRef.current += 1
      }
      const shouldClearFailed = failedItemIdRef.current !== null && !nextIds.has(failedItemIdRef.current)
      const nextFailedId = shouldClearFailed ? null : failedItemIdRef.current
      const next = { items: nextItems, paused: shouldClearFailed ? false : stateRef.current.paused }
      persist(next, nextFailedId)
      stateRef.current = next
      failedItemIdRef.current = nextFailedId
      if (shouldClearFailed) setFailedItemId(null)
      setState(next)
    },
    [persist]
  )

  const clear = useCallback(() => {
    drainEpochRef.current += 1
    setDraining(null)
    const next = { items: [], paused: false }
    persist(next, null)
    stateRef.current = next
    failedItemIdRef.current = null
    setFailedItemId(null)
    setState(next)
  }, [persist, setDraining])

  const removeId = useCallback(
    (id: string) => {
      // A manual-steer success routes by its own claim scope first: after a scope
      // switch, an unmount, or both, the live ref scope is stale, but the per-send
      // claim record still names the scope the item was sent from. Dequeue it there
      // (surgical entry op); otherwise the sent item stays queued and is delivered
      // again when the original scope is revisited.
      const claimScope = manualClaimsRef.current.get(id)
      if (claimScope !== undefined && claimScope !== scopeKeyRef.current) {
        removeIdFromScope(claimScope, id)
        return
      }
      // Unmounted (e.g. a composer steer-success continuation landing after a
      // remount): live refs are a frozen snapshot — persisting from them would
      // wipe work queued since. Dequeue surgically from the entry instead.
      if (!mountedRef.current) {
        removeIdFromScope(scopeKeyRef.current, id)
        return
      }
      const wasFailed = failedItemIdRef.current === id
      const wasDraining = drainingIdRef.current === id
      if (wasDraining) {
        // A send for the removed item is still in flight: invalidate its resolution
        // but keep the send claim held until it settles (its stale resolution
        // releases it). Clearing the claim here would let the drain effect — which
        // re-fires on any re-render while isFulfilled stays true — start the next
        // item concurrently with the unsettled send.
        drainEpochRef.current += 1
      }
      const nextFailedId = wasFailed ? null : failedItemIdRef.current
      const remaining = stateRef.current.items.filter((item) => item.id !== id)
      const next: FollowupQueueState = { items: remaining, paused: wasFailed ? false : stateRef.current.paused }
      persist(next, nextFailedId)
      stateRef.current = next
      failedItemIdRef.current = nextFailedId
      if (wasFailed) setFailedItemId(null)
      setState(next)
      // Deleting the failed head unpauses with the completion edge already consumed,
      // so continue with the next message immediately instead of stalling the queue —
      // unless the deleted item still has a send in flight (removal during a retry):
      // that send may yet open a turn whose completion drains the next item, so
      // starting another send now would put two sends in flight.
      if (wasFailed && remaining.length > 0 && !wasDraining) drainHead(remaining[0])
    },
    [persist, drainHead]
  )
  removeIdRef.current = removeId

  const setPaused = useCallback(
    (nextPaused: boolean) => {
      const next = { ...stateRef.current, paused: nextPaused }
      persist(next)
      stateRef.current = next
      setState(next)
      if (!nextPaused && isFulfilledRef.current && !failedItemIdRef.current && drainingIdRef.current === null) {
        const head = next.items[0]
        if (head && !inflightRef.current.has(head.id)) {
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
  useEffect(() => {
    if (!isFulfilled || stateRef.current.paused || failedItemIdRef.current || drainingIdRef.current !== null) return
    const head = stateRef.current.items[0]
    if (!head || inflightRef.current.has(head.id)) return
    markSeen()
    drainHead(head)
  }, [isFulfilled, markSeen, drainHead])

  // Shared exclusive claim between the auto-drain paths and manual steers: only one
  // send may be in flight per queue, whichever path started it.
  const tryClaimSend = useCallback(
    (id: string) => {
      // A pending auto-drain for the same payload blocks a manual steer of it, as does
      // a head the persisted entry no longer holds (settled + dequeued by a previous
      // hook instance after unmount — steering it would resend an already-sent payload).
      if (drainingIdRef.current !== null || inflightRef.current.has(id)) return false
      const claimScope = scopeKeyRef.current
      const entry = loadState(claimScope)
      if (!entry.items.some((item) => item.id === id)) return false
      const marker = entry.pendingDrainId ?? null
      if (marker && liveSends.has(marker)) return false
      setDraining(id)
      // Durably claim the steered head too: a remount or scope switch while the
      // manual send is pending must not auto-send the same payload again.
      pendingDrainIdRef.current = id
      manualClaimsRef.current.set(id, claimScope)
      liveSends.add(id)
      persist(stateRef.current)
      return true
    },
    [persist, setDraining]
  )
  const releaseSend = useCallback(
    (id: string) => {
      if (drainingIdRef.current === id) setDraining(null)
      liveSends.delete(id)
      const claimScope = manualClaimsRef.current.get(id)
      manualClaimsRef.current.delete(id)
      // Scrub the durable claim from the scope it was taken in (which may differ
      // from the current scope after a switch); id-guarded so a newer send's
      // claim is never touched.
      if (claimScope !== undefined) {
        if (pendingDrainIdRef.current === id) pendingDrainIdRef.current = null
        clearPendingInScope(claimScope, id)
      } else if (pendingDrainIdRef.current === id) {
        pendingDrainIdRef.current = null
      }
    },
    [setDraining]
  )

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
    failedItemIdRef.current = null
    const next = { items: remaining, paused: false }
    persist(next, null)
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
    skipFailed,
    drainingId,
    tryClaimSend,
    releaseSend
  }
}
