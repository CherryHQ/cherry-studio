/**
 * React binding for {@link executionStreamOverlayService}, which owns the
 * per-execution streaming overlay (readers, snapshots, batching) keyed by
 * ConversationRef. This hook only acquires/releases a refcounted view, feeds the
 * service the consumer-visible execution set + DB seed rows, and reads the
 * retained view via `useSyncExternalStore` — so unmounting (route/tab/conversation
 * switch) no longer tears the stream down, and remounting restores the live
 * overlay synchronously. Reader/seed semantics live in the service.
 */
import { executionStreamOverlayService } from '@renderer/services/aiTransport'
import { type ConversationExecutionId, type ConversationRef, conversationRefKey } from '@shared/ai/conversation'
import type { ActiveNodeDecision, ConversationExecutionProjection } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

export type { ExecutionFinishEvent } from '@renderer/services/aiTransport'
import type {
  ExecutionFinishEvent,
  ExecutionOverlayActiveNodeOverride,
  ExecutionOverlayRecord
} from '@renderer/services/aiTransport'

export interface UseExecutionOverlayOptions {
  onFinish?: (executionId: ConversationExecutionId, event: ExecutionFinishEvent) => void
  /** Persistent projections refresh committed rows at Conversation quiescence. */
  refreshOnQuiesced?: () => Promise<unknown>
}

export interface ExecutionOverlayApi {
  /** messageId -> latest streamed parts. messageId = outputNodeId, or the
   *  start-chunk id when the execution has no pre-allocated row (temp topic). */
  overlay: Record<string, CherryMessagePart[]>
  /** Latest assistant snapshot per execution, in insertion order. */
  liveAssistants: CherryUIMessage[]
  /** Execution records whose message stays stable while phase changes active → settled. */
  records: ExecutionOverlayRecord[]
  optimisticMessages: CherryUIMessage[]
  projectedExecutions: ConversationExecutionProjection[]
  activeNodeOverride: ExecutionOverlayActiveNodeOverride | null
  refreshError: Error | null
  seedReservations: (
    messages: readonly CherryUIMessage[],
    executions: readonly ConversationExecutionProjection[],
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

interface ConversationOverlayBinding {
  readonly conversation: ConversationRef
  readonly key: string
  readonly consumer: object
  uiMessages: CherryUIMessage[]
  onFinish: UseExecutionOverlayOptions['onFinish']
  refreshOnQuiesced: UseExecutionOverlayOptions['refreshOnQuiesced']
  readonly getSeedMessages: () => CherryUIMessage[]
}

function createConversationOverlayBinding(conversation: ConversationRef): ConversationOverlayBinding {
  const binding = {
    conversation,
    key: conversationRefKey(conversation),
    consumer: {},
    uiMessages: [],
    onFinish: undefined,
    refreshOnQuiesced: undefined,
    getSeedMessages: () => binding.uiMessages
  } satisfies ConversationOverlayBinding
  return binding
}

export function useExecutionOverlay(
  conversation: ConversationRef,
  activeExecutions: readonly ConversationExecutionProjection[],
  uiMessages: CherryUIMessage[],
  options: UseExecutionOverlayOptions = {}
): ExecutionOverlayApi {
  const key = conversationRefKey(conversation)
  const bindingRef = useRef<ConversationOverlayBinding>(undefined)
  if (!bindingRef.current || bindingRef.current.key !== key) {
    bindingRef.current = createConversationOverlayBinding(conversation)
  }
  const binding = bindingRef.current
  binding.uiMessages = uiMessages
  binding.onFinish = options.onFinish
  binding.refreshOnQuiesced = options.refreshOnQuiesced

  // Declared before the sync effect so acquisition (entry creation) always
  // precedes reader convergence for a new Conversation.
  useEffect(() => {
    executionStreamOverlayService.acquire(binding.conversation)
    const offFinish = executionStreamOverlayService.onFinish(binding.conversation, (executionId, event) =>
      binding.onFinish?.(executionId, event)
    )
    // The service owns the quiesce → refresh → retire handoff (and its retry);
    // this only lends it the consumer's DB refetch while mounted.
    const offRefresh = binding.refreshOnQuiesced
      ? executionStreamOverlayService.registerRefreshPort(
          binding.conversation,
          () => binding.refreshOnQuiesced?.() ?? Promise.resolve()
        )
      : undefined
    return () => {
      offFinish()
      offRefresh?.()
      executionStreamOverlayService.release(binding.conversation, binding.consumer)
    }
  }, [binding])

  // No cleanup: departure must not cancel readers (release() handles removal).
  useEffect(() => {
    executionStreamOverlayService.syncExecutions(
      binding.conversation,
      binding.consumer,
      activeExecutions,
      binding.getSeedMessages
    )
  }, [activeExecutions, binding])

  const subscribe = useCallback(
    (listener: () => void) => executionStreamOverlayService.subscribe(binding.conversation, listener),
    [binding]
  )
  const view = useSyncExternalStore(
    subscribe,
    useCallback(() => executionStreamOverlayService.getView(binding.conversation), [binding])
  )

  const api = useRef<{ binding: ConversationOverlayBinding; value: ExecutionOverlayApi }>(undefined)
  if (!api.current || api.current.binding !== binding) {
    const value: ExecutionOverlayApi = {
      overlay: view.overlay,
      liveAssistants: view.liveAssistants,
      records: view.records,
      optimisticMessages: view.optimisticMessages,
      projectedExecutions: view.projectedExecutions,
      activeNodeOverride: view.activeNodeOverride,
      refreshError: view.refreshError,
      seedReservations: (messages, executions, activeNodeDecision, previousActiveNodeId) =>
        executionStreamOverlayService.seedReservations(
          binding.conversation,
          messages,
          executions,
          activeNodeDecision,
          previousActiveNodeId,
          binding.getSeedMessages
        ),
      disposeOverlay: (messageId: string) =>
        executionStreamOverlayService.disposeOverlay(binding.conversation, messageId),
      reset: () => executionStreamOverlayService.reset(binding.conversation),
      clear: () => executionStreamOverlayService.clear(binding.conversation)
    }
    api.current = {
      binding,
      value
    }
  }
  api.current.value.overlay = view.overlay
  api.current.value.liveAssistants = view.liveAssistants
  api.current.value.records = view.records
  api.current.value.optimisticMessages = view.optimisticMessages
  api.current.value.projectedExecutions = view.projectedExecutions
  api.current.value.activeNodeOverride = view.activeNodeOverride
  api.current.value.refreshError = view.refreshError
  return api.current.value
}
