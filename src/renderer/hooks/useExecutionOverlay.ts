import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * React binding for {@link executionStreamOverlayService}, which owns the
 * per-execution streaming overlay (readers, snapshots, rAF batching) keyed by
 * `topicId`. This hook only acquires/releases a refcounted view, feeds the
 * service the consumer-visible execution set + DB seed rows, and reads the
 * retained view via `useSyncExternalStore` — so unmounting (route/tab/conversation
 * switch) no longer tears the stream down, and remounting restores the live
 * overlay synchronously. Reader/seed semantics live in the service.
 */
import { executionStreamOverlayService } from '@renderer/services/aiTransport'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

export type { ExecutionFinishEvent } from '@renderer/services/aiTransport'
import type { ExecutionFinishEvent } from '@renderer/services/aiTransport'

export interface UseExecutionOverlayOptions {
  onFinish?: (executionId: string, event: ExecutionFinishEvent) => void
}

export interface ExecutionOverlayApi {
  /** messageId -> latest streamed parts. messageId = anchorMessageId, or the
   *  start-chunk id when the execution has no pre-allocated row (temp topic). */
  overlay: Record<string, CherryMessagePart[]>
  /** Latest assistant snapshot per execution, in insertion order. */
  liveAssistants: CherryUIMessage[]
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
  const topicIdRef = useRef(topicId)
  topicIdRef.current = topicId

  // Declared before the sync effect so acquisition (entry creation) always
  // precedes reader convergence for a new topicId.
  useEffect(() => {
    executionStreamOverlayService.acquire(topicId)
    const offFinish = executionStreamOverlayService.onFinish(topicId, (executionId, event) =>
      onFinishRef.current?.(executionId, event)
    )
    return () => {
      offFinish()
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
      disposeOverlay: (messageId: string) =>
        executionStreamOverlayService.disposeOverlay(topicIdRef.current, messageId),
      reset: () => executionStreamOverlayService.reset(topicIdRef.current),
      clear: () => executionStreamOverlayService.clear(topicIdRef.current)
    }
  }
  api.current.overlay = view.overlay
  api.current.liveAssistants = view.liveAssistants
  return api.current
}
