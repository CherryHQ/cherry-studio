/**
 * Per-execution streaming overlay, built on {@link useTopicStreamSubscription}.
 *
 * Replaces the per-execution AI SDK `Chat` (`useExecutionChats` +
 * `ExecutionStreamCollector` + `useExecutionMessages`). A `Chat` is a
 * *stateful session* whose `state.messages` accumulates across turns; reusing
 * it made a new turn resume from the previous turn's finished assistant
 * ("previous answer + new stream"). Here each execution gets a **one-shot
 * `readUIMessageStream` reader with zero cross-turn state**: the assembler is
 * the same primitive Main's accumulator uses, so tool/reasoning/data/step
 * assembly is identical, but there is no Chat object to carry stale parts.
 *
 * Seed rule (continue-safe): the reader is seeded with the message whose id
 * is `anchorMessageId` taken from the *current* DB truth (`uiMessages`). For
 * a fresh placeholder that row has empty parts; for a tool-approval/continue
 * the row already carries the prior assistant parts (incl. tool-call parts)
 * so a streamed `tool-output` chunk can merge onto the matching `tool-input`.
 * It is re-derived from current DB on every reader start and never carried
 * across turns — that, plus a fresh reader per turn, is the structural
 * anti-pollution guarantee (not "force empty parts").
 */
import { loggerService } from '@logger'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { isToolUIPart, readUIMessageStream } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useTopicStreamSubscription } from './useTopicStreamSubscription'

const logger = loggerService.withContext('useExecutionOverlay')

export interface ExecutionFinishEvent {
  message: CherryUIMessage
  isAbort: boolean
  isError: boolean
}

export interface UseExecutionOverlayOptions {
  onFinish?: (executionId: string, event: ExecutionFinishEvent) => void
}

export interface ExecutionOverlayApi {
  /** messageId -> latest streamed parts. messageId = anchorMessageId, or the
   *  start-chunk id when the execution has no pre-allocated row (temp topic). */
  overlay: Record<string, CherryMessagePart[]>
  /** Latest assistant snapshot per execution, in insertion order. Replaces
   *  `collectLiveAssistants(executionMessagesById)`. */
  liveAssistants: CherryUIMessage[]
  /** Drop one overlay/snapshot entry by its message id (post-persist handoff). */
  disposeOverlay: (messageId: string) => void
  /** Drop every overlay/snapshot entry (e.g. quick-assistant clear()). */
  reset: () => void
}

interface ReaderHandle {
  executionId: UniqueModelId
  anchorMessageId?: string
  cancel: () => void
  unregister: () => void
}

interface PendingSnapshot {
  epoch: number
  readerVersion: number
  snapshot: CherryUIMessage
}

function executionKey(executionId: UniqueModelId, anchorMessageId?: string): string {
  return JSON.stringify([executionId, anchorMessageId ?? null])
}

function pickSeed(uiMessages: CherryUIMessage[], anchorMessageId?: string): CherryUIMessage | undefined {
  if (!anchorMessageId) return undefined
  const found = uiMessages.find((m) => m.id === anchorMessageId)
  if (!found) {
    return { id: anchorMessageId, role: 'assistant', parts: [] } as CherryUIMessage
  }
  // readUIMessageStream mutates `message.parts` in place. `found` is the live, render-stable
  // SWR-derived row whose `parts` array aliases the SWR cache, so seeding the reader with it
  // would corrupt cached history and race the DB-authoritative refresh(). Clone the parts so
  // the reader only ever writes to a throwaway. (DB parts are JSON-serializable.)
  return { ...found, parts: structuredClone(found.parts ?? []) }
}

function canReuseSettledPart(previous: CherryMessagePart, next: CherryMessagePart): boolean {
  if (previous.type !== next.type) return false

  if (previous.type === 'text' && next.type === 'text') {
    return previous.state !== 'streaming' && next.state !== 'streaming' && previous.text === next.text
  }

  if (previous.type === 'reasoning' && next.type === 'reasoning') {
    return previous.state !== 'streaming' && next.state !== 'streaming' && previous.text === next.text
  }

  if (isToolUIPart(previous) && isToolUIPart(next)) {
    const previousTool = previous as unknown as { preliminary?: boolean; state?: string; toolCallId?: string }
    const nextTool = next as unknown as { preliminary?: boolean; state?: string; toolCallId?: string }
    if (previousTool.toolCallId !== nextTool.toolCallId || previousTool.state !== nextTool.state) return false
    if (previousTool.state === 'output-available') {
      return previousTool.preliminary !== true && nextTool.preliminary !== true
    }
    return (
      previousTool.state === 'output-error' ||
      previousTool.state === 'output-denied' ||
      previousTool.state === 'cancelled'
    )
  }

  // These transport parts are append-only in processUIMessageStream. Data
  // parts are deliberately excluded because an id-bearing data part can be
  // updated in place by a later chunk.
  return (
    previous.type === 'file' ||
    previous.type === 'source-url' ||
    previous.type === 'source-document' ||
    previous.type === 'step-start'
  )
}

/**
 * `readUIMessageStream` clones the complete message for every chunk. Restore
 * references for protocol-settled parts so rendering work stays proportional
 * to the live frontier instead of the full accumulated transcript.
 */
function shareSettledPartReferences(
  previous: CherryMessagePart[] | undefined,
  next: CherryMessagePart[]
): CherryMessagePart[] {
  if (!previous || previous.length === 0 || next.length === 0) return next

  let reusedAny = false
  let reusedAll = previous.length === next.length
  const shared = next.map((part, index) => {
    const previousPart = previous[index]
    if (previousPart === part || (previousPart && canReuseSettledPart(previousPart, part))) {
      reusedAny = true
      return previousPart
    }
    reusedAll = false
    return part
  })

  if (reusedAll) return previous
  return reusedAny ? shared : next
}

export function useExecutionOverlay(
  topicId: string,
  activeExecutions: readonly ActiveExecution[],
  uiMessages: CherryUIMessage[],
  options: UseExecutionOverlayOptions = {}
): ExecutionOverlayApi {
  const sub = useTopicStreamSubscription(topicId)

  // executionId -> latest message snapshot. Retained after a reader tears
  // down (so consumers can read the final frame / Phase 2 last-good) until
  // the same execution restarts, an explicit dispose, or a topic switch.
  const [snapshots, setSnapshots] = useState<Record<string, CherryUIMessage>>({})
  const snapshotsRef = useRef(snapshots)
  snapshotsRef.current = snapshots

  const uiMessagesRef = useRef(uiMessages)
  uiMessagesRef.current = uiMessages
  const onFinishRef = useRef(options.onFinish)
  onFinishRef.current = options.onFinish
  const readersRef = useRef<Map<string, ReaderHandle>>(new Map())
  const pendingSnapshotsRef = useRef<Map<string, PendingSnapshot>>(new Map())
  const snapshotFrameRef = useRef<number | null>(null)
  const epochRef = useRef(0)
  const readerVersionsRef = useRef<Map<string, number>>(new Map())

  const cancelSnapshotFrame = useCallback(() => {
    if (snapshotFrameRef.current === null) return
    window.cancelAnimationFrame(snapshotFrameRef.current)
    snapshotFrameRef.current = null
  }, [])

  const invalidatePendingSnapshots = useCallback(() => {
    epochRef.current += 1
    pendingSnapshotsRef.current.clear()
    cancelSnapshotFrame()
  }, [cancelSnapshotFrame])

  const flushPendingSnapshots = useCallback(
    (expectedEpoch: number) => {
      if (expectedEpoch !== epochRef.current) return

      cancelSnapshotFrame()
      const pending = pendingSnapshotsRef.current
      if (pending.size === 0) return
      pendingSnapshotsRef.current = new Map()

      setSnapshots((previous) => {
        let next = previous
        for (const [executionId, entry] of pending) {
          if (entry.epoch !== epochRef.current) continue
          if (readerVersionsRef.current.get(executionId) !== entry.readerVersion) continue
          if (previous[executionId] === entry.snapshot) continue
          if (next === previous) next = { ...previous }
          next[executionId] = entry.snapshot
        }
        return next
      })
    },
    [cancelSnapshotFrame]
  )

  const queueSnapshot = useCallback(
    (executionId: string, snapshot: CherryUIMessage, epoch: number, readerVersion: number) => {
      if (epoch !== epochRef.current || readerVersionsRef.current.get(executionId) !== readerVersion) return

      pendingSnapshotsRef.current.set(executionId, { epoch, readerVersion, snapshot })
      if (snapshotFrameRef.current !== null) return

      snapshotFrameRef.current = window.requestAnimationFrame(() => {
        snapshotFrameRef.current = null
        flushPendingSnapshots(epoch)
      })
    },
    [flushPendingSnapshots]
  )

  // Topic switch → tear down the previous topic's readers and drop all stale
  // overlay state. Runs as an effect (not in the render body) so the teardown
  // happens after commit, never during a concurrent/abandoned render.
  useEffect(() => {
    const readers = readersRef.current
    invalidatePendingSnapshots()
    readerVersionsRef.current.clear()
    setSnapshots({})
    return () => {
      invalidatePendingSnapshots()
      for (const r of readers.values()) {
        r.cancel()
        r.unregister()
      }
      readers.clear()
    }
  }, [invalidatePendingSnapshots, topicId])

  useEffect(() => {
    const readers = readersRef.current
    const live = new Set(activeExecutions.map((e) => executionKey(e.executionId, e.anchorMessageId)))

    for (const [key, handle] of [...readers]) {
      if (live.has(key)) continue
      handle.cancel()
      handle.unregister()
      readers.delete(key)
    }

    for (const { executionId, anchorMessageId } of activeExecutions) {
      const key = executionKey(executionId, anchorMessageId)
      if (readers.has(key)) continue

      const branch = sub.register(executionId, anchorMessageId)
      const readerEpoch = epochRef.current
      const readerVersion = (readerVersionsRef.current.get(executionId) ?? 0) + 1
      readerVersionsRef.current.set(executionId, readerVersion)
      pendingSnapshotsRef.current.delete(executionId)
      // Readers use execution+anchor keys; snapshots stay executionId-keyed because only one anchor is live per execution.
      // New turn for this execution: clear any retained prior snapshot.
      setSnapshots((prev) => {
        if (!(executionId in prev)) return prev
        const next = { ...prev }
        delete next[executionId]
        return next
      })

      let cancelled = false
      let terminal: { isAbort: boolean; isError: boolean } | undefined
      const offTerminal = sub.onExecutionTerminal((id, t) => {
        if (id !== executionId) return
        if (t.anchorMessageId !== undefined && t.anchorMessageId !== anchorMessageId) return
        terminal = t
      })
      const seed = pickSeed(uiMessagesRef.current, anchorMessageId)

      readers.set(key, {
        executionId,
        anchorMessageId,
        cancel: () => {
          cancelled = true
        },
        unregister: () => {
          offTerminal()
          sub.unregister(executionId, anchorMessageId)
        }
      })

      void (async () => {
        let last: CherryUIMessage | undefined
        try {
          for await (const snapshot of readUIMessageStream<CherryUIMessage>({
            stream: branch,
            message: seed,
            terminateOnError: false,
            onError: (err) => logger.warn('readUIMessageStream error', { topicId, executionId, err })
          })) {
            if (cancelled) break
            const sharedParts = shareSettledPartReferences(
              last?.parts as CherryMessagePart[] | undefined,
              snapshot.parts as CherryMessagePart[]
            )
            const nextSnapshot = sharedParts === snapshot.parts ? snapshot : { ...snapshot, parts: sharedParts }
            last = nextSnapshot
            queueSnapshot(executionId, nextSnapshot, readerEpoch, readerVersion)
          }
        } catch (err) {
          logger.warn('execution reader threw', { topicId, executionId, err })
        } finally {
          offTerminal()
          if (!cancelled) {
            // Terminal frames must be visible before the overlay handoff. This
            // is the sole intentional commit outside the animation-frame cadence.
            flushPendingSnapshots(readerEpoch)
            const t = terminal ?? { isAbort: false, isError: false }
            const message = last ?? seed
            if (message || t.isError) {
              onFinishRef.current?.(executionId, {
                message: message ?? { id: '', role: 'assistant', parts: [] },
                isAbort: t.isAbort,
                isError: t.isError
              })
            }
          }
        }
      })()
    }
  }, [topicId, activeExecutions, flushPendingSnapshots, queueSnapshot, sub])

  const overlay = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const out: Record<string, CherryMessagePart[]> = {}
    for (const snapshot of Object.values(snapshots)) {
      if (snapshot?.parts?.length) out[snapshot.id] = snapshot.parts as CherryMessagePart[]
    }
    return out
  }, [snapshots])

  const liveAssistants = useMemo<CherryUIMessage[]>(
    () => Object.values(snapshots).filter((s): s is CherryUIMessage => s?.role === 'assistant'),
    [snapshots]
  )

  const api = useRef<ExecutionOverlayApi>(undefined as never)
  if (!api.current) {
    api.current = {
      overlay,
      liveAssistants,
      disposeOverlay: (messageId: string) => {
        const snapshotEntry = Object.entries(snapshotsRef.current).find(([, snapshot]) => snapshot.id === messageId)
        const pendingEntry = [...pendingSnapshotsRef.current].find(([, entry]) => entry.snapshot.id === messageId)
        const executionId = snapshotEntry?.[0] ?? pendingEntry?.[0]
        if (executionId) {
          pendingSnapshotsRef.current.delete(executionId)
          readerVersionsRef.current.set(executionId, (readerVersionsRef.current.get(executionId) ?? 0) + 1)
          if (pendingSnapshotsRef.current.size === 0) cancelSnapshotFrame()
        }
        setSnapshots((prev) => {
          const entry = Object.entries(prev).find(([, s]) => s.id === messageId)
          if (!entry) return prev
          const next = { ...prev }
          delete next[entry[0]]
          return next
        })
      },
      reset: () => {
        invalidatePendingSnapshots()
        readerVersionsRef.current.clear()
        setSnapshots({})
      }
    }
  }
  api.current.overlay = overlay
  api.current.liveAssistants = liveAssistants
  return api.current
}
