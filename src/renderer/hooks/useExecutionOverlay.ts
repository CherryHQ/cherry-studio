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
import { readUIMessageStream } from 'ai'
import { useEffect, useMemo, useRef, useState } from 'react'

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
  cancel: () => void
  unregister: () => void
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

  const uiMessagesRef = useRef(uiMessages)
  uiMessagesRef.current = uiMessages
  const onFinishRef = useRef(options.onFinish)
  onFinishRef.current = options.onFinish
  const readersRef = useRef<Map<UniqueModelId, ReaderHandle>>(new Map())

  // Topic switch → tear down the previous topic's readers and drop all stale
  // overlay state. Runs as an effect (not in the render body) so the teardown
  // happens after commit, never during a concurrent/abandoned render.
  useEffect(() => {
    setSnapshots({})
    return () => {
      for (const r of readersRef.current.values()) {
        r.cancel()
        r.unregister()
      }
      readersRef.current.clear()
    }
  }, [topicId])

  useEffect(() => {
    const readers = readersRef.current
    const live = new Set(activeExecutions.map((e) => e.executionId))

    for (const [executionId, handle] of [...readers]) {
      if (live.has(executionId)) continue
      handle.cancel()
      handle.unregister()
      readers.delete(executionId)
    }

    for (const { executionId, anchorMessageId } of activeExecutions) {
      if (readers.has(executionId)) continue

      const branch = sub.register(executionId)
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
        if (id === executionId) terminal = t
      })
      const seed = pickSeed(uiMessagesRef.current, anchorMessageId)

      readers.set(executionId, {
        cancel: () => {
          cancelled = true
        },
        unregister: () => {
          offTerminal()
          sub.unregister(executionId)
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
            last = snapshot
            setSnapshots((prev) => ({ ...prev, [executionId]: snapshot }))
          }
        } catch (err) {
          logger.warn('execution reader threw', { topicId, executionId, err })
        } finally {
          offTerminal()
          if (!cancelled) {
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
  }, [topicId, activeExecutions, sub])

  useEffect(() => {
    const readers = readersRef.current
    return () => {
      for (const r of readers.values()) {
        r.cancel()
        r.unregister()
      }
      readers.clear()
    }
  }, [])

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
      disposeOverlay: (messageId: string) =>
        setSnapshots((prev) => {
          const entry = Object.entries(prev).find(([, s]) => s.id === messageId)
          if (!entry) return prev
          const next = { ...prev }
          delete next[entry[0]]
          return next
        }),
      reset: () => setSnapshots({})
    }
  }
  api.current.overlay = overlay
  api.current.liveAssistants = liveAssistants
  return api.current
}
