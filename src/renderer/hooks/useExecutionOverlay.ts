import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

import { executionStreamOverlayService } from '@renderer/services/aiTransport'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

export type { ExecutionFinishEvent } from '@renderer/services/aiTransport'
import type { ExecutionFinishEvent } from '@renderer/services/aiTransport'

export interface UseExecutionOverlayOptions {
  onUpdate?: (executionId: string, event: Pick<ExecutionFinishEvent, 'attemptId' | 'message'>) => void
  onLeave?: () => void
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
  /** Drop settled overlay/snapshot entries (terminal handoff); active attempts survive. */
  reset: () => void
  /** Destructively drop every overlay/snapshot entry (quick-assistant clear()). */
  clear: () => void
}

export function useExecutionOverlay(
  topicId: string,
  activeExecutions: readonly ActiveExecution[],
  options: UseExecutionOverlayOptions = {}
): ExecutionOverlayApi {
  // Identity of this consumer inside the service's refcount/contribution maps.
  const consumer = useRef({}).current

  const onFinishRef = useRef(options.onFinish)
  onFinishRef.current = options.onFinish
  const optionsRef = useRef(options)
  optionsRef.current = options
  const topicIdRef = useRef(topicId)
  topicIdRef.current = topicId

  // Register callbacks before acquiring an already-published terminal view.
  useEffect(() => {
    const onLeave = optionsRef.current.onLeave
    const offUpdate = executionStreamOverlayService.onUpdate(topicId, (executionId, event) =>
      optionsRef.current.onUpdate?.(executionId, event)
    )
    const offFinish = executionStreamOverlayService.onFinish(topicId, (executionId, event) =>
      onFinishRef.current?.(executionId, event)
    )
    executionStreamOverlayService.acquire(topicId)
    return () => {
      offUpdate()
      offFinish()
      onLeave?.()
      executionStreamOverlayService.release(topicId, consumer)
    }
  }, [consumer, topicId])

  // Releasing a view never stops its native execution.
  useEffect(() => {
    executionStreamOverlayService.syncExecutions(topicId, consumer, activeExecutions)
  }, [activeExecutions, consumer, topicId])

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
