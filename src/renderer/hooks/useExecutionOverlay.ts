/**
 * React binding for {@link executionStreamOverlayService}, which owns the
 * per-execution streaming overlay (readers, snapshots, rAF batching) keyed by
 * `topicId`. This hook only acquires/releases a refcounted view, feeds the
 * service the consumer-visible execution set + DB seed rows, and reads the
 * retained view via `useSyncExternalStore` — so unmounting (route/tab/conversation
 * switch) no longer tears the stream down, and remounting restores the live
 * overlay synchronously. Reader/seed semantics live in the service.
 */
import { loggerService } from '@logger'
import { executionStreamOverlayService } from '@renderer/services/aiTransport'
import type { ActiveExecution, ActiveNodeDecision } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

export type { ExecutionFinishEvent } from '@renderer/services/aiTransport'
import type {
  ExecutionFinishEvent,
  ExecutionOverlayActiveNodeOverride,
  ExecutionOverlayAttempt
} from '@renderer/services/aiTransport'

export interface UseExecutionOverlayOptions {
  onFinish?: (executionId: string, event: ExecutionFinishEvent) => void
  /** Persistent projections refresh committed rows at TopicQuiesced, then retire final overlays. */
  refreshOnQuiesced?: () => Promise<unknown>
}

const logger = loggerService.withContext('useExecutionOverlay')

export interface ExecutionOverlayApi {
  /** messageId -> latest streamed parts. messageId = anchorMessageId, or the
   *  start-chunk id when the execution has no pre-allocated row (temp topic). */
  overlay: Record<string, CherryMessagePart[]>
  /** Latest assistant snapshot per execution, in insertion order. */
  liveAssistants: CherryUIMessage[]
  /** Attempt records whose message stays stable while phase changes active → settled. */
  attempts: ExecutionOverlayAttempt[]
  optimisticMessages: CherryUIMessage[]
  projectedExecutions: ActiveExecution[]
  activeNodeOverride: ExecutionOverlayActiveNodeOverride | null
  refreshError: Error | null
  seedReservations: (
    messages: readonly CherryUIMessage[],
    executions: readonly ActiveExecution[],
    activeNodeDecision: ActiveNodeDecision | undefined,
    previousActiveNodeId: string | null
  ) => void
  /** Drop one overlay/snapshot entry by its message id (post-persist handoff). */
  disposeOverlay: (messageId: string) => void
  /** Drop settled overlay/snapshot entries (terminal handoff); live readers survive. */
  reset: () => void
  /** Destructively drop every overlay/snapshot entry (quick-assistant clear()). */
  clear: () => void
}

export function useExecutionOverlay(
  topicId: string,
  activeExecutions: readonly ActiveExecution[],
  uiMessages: CherryUIMessage[],
  options: UseExecutionOverlayOptions = {}
): ExecutionOverlayApi {
  // Identity of this consumer inside the service's refcount/contribution maps.
  const consumer = useRef({}).current

  const uiMessagesRef = useRef(uiMessages)
  uiMessagesRef.current = uiMessages
  const onFinishRef = useRef(options.onFinish)
  onFinishRef.current = options.onFinish
  const refreshOnQuiescedRef = useRef(options.refreshOnQuiesced)
  refreshOnQuiescedRef.current = options.refreshOnQuiesced
  const topicIdRef = useRef(topicId)
  topicIdRef.current = topicId

  // Declared before the sync effect so acquisition (entry creation) always
  // precedes reader convergence for a new topicId.
  useEffect(() => {
    executionStreamOverlayService.acquire(topicId)
    const offFinish = executionStreamOverlayService.onFinish(topicId, (executionId, event) =>
      onFinishRef.current?.(executionId, event)
    )
    const offQuiesced = executionStreamOverlayService.onTopicQuiesced(topicId, ({ throughAttemptId }) => {
      const refresh = refreshOnQuiescedRef.current
      if (!refresh) return
      executionStreamOverlayService.setRefreshError(topicId, null)
      void refresh()
        .then(() => executionStreamOverlayService.retireThrough(topicId, throughAttemptId))
        .catch((error) => {
          const refreshError = error instanceof Error ? error : new Error(String(error))
          executionStreamOverlayService.setRefreshError(topicId, refreshError)
          logger.warn('topic projection refresh failed; retaining final overlay', refreshError)
        })
    })
    return () => {
      offFinish()
      offQuiesced()
      executionStreamOverlayService.release(topicId, consumer)
    }
  }, [consumer, topicId])

  const getSeedMessages = useCallback(() => uiMessagesRef.current, [])
  // No cleanup: departure must not cancel readers (release() handles removal).
  useEffect(() => {
    executionStreamOverlayService.syncExecutions(topicId, consumer, activeExecutions, getSeedMessages)
  }, [activeExecutions, consumer, getSeedMessages, topicId])

  const subscribe = useCallback(
    (listener: () => void) => executionStreamOverlayService.subscribe(topicId, listener),
    [topicId]
  )
  const view = useSyncExternalStore(
    subscribe,
    useCallback(() => executionStreamOverlayService.getView(topicId), [topicId])
  )

  const api = useRef<ExecutionOverlayApi>(undefined as never)
  if (!api.current) {
    api.current = {
      overlay: view.overlay,
      liveAssistants: view.liveAssistants,
      attempts: view.attempts,
      optimisticMessages: view.optimisticMessages,
      projectedExecutions: view.projectedExecutions,
      activeNodeOverride: view.activeNodeOverride,
      refreshError: view.refreshError,
      seedReservations: (messages, executions, activeNodeDecision, previousActiveNodeId) =>
        executionStreamOverlayService.seedReservations(
          topicIdRef.current,
          messages,
          executions,
          activeNodeDecision,
          previousActiveNodeId,
          getSeedMessages
        ),
      disposeOverlay: (messageId: string) =>
        executionStreamOverlayService.disposeOverlay(topicIdRef.current, messageId),
      reset: () => executionStreamOverlayService.reset(topicIdRef.current),
      clear: () => executionStreamOverlayService.clear(topicIdRef.current)
    }
  }
  api.current.overlay = view.overlay
  api.current.liveAssistants = view.liveAssistants
  api.current.attempts = view.attempts
  api.current.optimisticMessages = view.optimisticMessages
  api.current.projectedExecutions = view.projectedExecutions
  api.current.activeNodeOverride = view.activeNodeOverride
  api.current.refreshError = view.refreshError
  return api.current
}
