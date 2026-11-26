import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
// eslint-disable-next-line barrel/closed -- Bypass the flow barrel so chat startup does not touch TopicMessageFlowCanvas.
import {
  buildTopicMessageFlowLiveState,
  type TopicMessageFlowLiveState
} from '@renderer/components/chat/flow/topicMessageFlowLiveTree'
import type { MessageListRuntime } from '@renderer/components/chat/messages/types'
import { dispatchLocateMessage } from '@renderer/components/chat/messages/utils/dispatchLocateMessage'
import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import { useToolApprovalComposerOverrides } from '@renderer/components/composer/useToolApprovalComposerOverrides'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import { useConversationErrorToasts } from '@renderer/hooks/useConversationErrorToasts'
import { useConversationTurnController } from '@renderer/hooks/useConversationTurnController'
import { useHistoryReplies } from '@renderer/hooks/useHistoryReplies'
import type { ReplyHistory } from '@renderer/hooks/useHistoryRowUpdates'
import { useStableStringArray } from '@renderer/hooks/useStableStringArray'
import { useTopicCompletion } from '@renderer/hooks/useTopicCompletion'
import { useTopicSpeech } from '@renderer/hooks/useTopicSpeech'
import { useTopicAwaitingApproval, useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { autoReadService } from '@renderer/services/voice'
import type { Assistant } from '@renderer/types/assistant'
import type { ExecutionFinishEvent } from '@renderer/types/message'
import type { Topic } from '@renderer/types/topic'
import { createPartsByMessageId } from '@renderer/utils/message/exportView'
import { mergeLiveReplies, mergeMessagesById } from '@renderer/utils/message/mergeMessagesById'
import { activeReplyIds, replyParts } from '@renderer/utils/message/messagePartRows'
import { isRenderableConversationMessage } from '@renderer/utils/message/messageProjection'
import type { ActiveExecution, ComposerChatTarget } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { ServiceTierSelection, UniqueModelId } from '@shared/data/types/model'
import { hasClearContextPart } from '@shared/data/types/uiParts'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import { type ReservedMessageSeedOptions, useChatWriteActions } from './hooks/useChatWriteActions'
import { useToolApprovalBridge } from './hooks/useToolApprovalBridge'
import { useTopicMessagesCache, type UseTopicMessagesCacheParams } from './hooks/useTopicMessagesCache'

const logger = loggerService.withContext('useChatRuntimeState')

export interface ChatTurnInput {
  text: string
  options?: {
    mentionedModels?: UniqueModelId[]
    userMessageParts?: CherryMessagePart[]
    reasoningEffort?: ReasoningEffortOption
    serviceTier?: ServiceTierSelection
    fastMode?: boolean
    chatTarget?: ComposerChatTarget
  }
}

interface UseChatRuntimeStateParams {
  topic: Topic
  isHistoryLoading: boolean
  replyHistory: ReplyHistory
  displayIndex(id: string): number | undefined
  uiMessages: CherryUIMessage[]
  refresh: () => Promise<void>
  activeNodeId: string | null
  messagesCacheMutate: UseTopicMessagesCacheParams['mutate']
  assistant?: Assistant
  composerModelId?: UniqueModelId
  onBranchLiveStateChange?: (state: TopicMessageFlowLiveState | null) => void
}

function mergeActiveExecutions(...sources: ReadonlyArray<readonly ActiveExecution[]>): ActiveExecution[] {
  const order: string[] = []
  const byId = new Map<string, ActiveExecution>()

  for (const executions of sources) {
    for (const execution of executions) {
      const slot = JSON.stringify([execution.executionId, execution.anchorMessageId ?? null])
      const existing = byId.get(slot)
      if (!existing) order.push(slot)
      if (existing && existing.attemptId > execution.attemptId) continue
      byId.set(slot, {
        ...existing,
        ...execution,
        anchorMessageId: execution.anchorMessageId ?? existing?.anchorMessageId
      })
    }
  }

  return order.flatMap((slot) => {
    const execution = byId.get(slot)
    return execution ? [execution] : []
  })
}

function projectBranchFlowMessages(
  optimisticReservations: CherryUIMessage[],
  persistedMessages: CherryUIMessage[],
  liveMessages: CherryUIMessage[]
): CherryUIMessage[] {
  return mergeMessagesById(optimisticReservations, persistedMessages, liveMessages)
}

function executionAttemptKey(execution: ActiveExecution): number {
  return execution.attemptId
}

export function useChatRuntimeState({
  topic,
  isHistoryLoading,
  replyHistory,
  displayIndex,
  uiMessages,
  refresh,
  activeNodeId,
  messagesCacheMutate,
  assistant,
  composerModelId,
  onBranchLiveStateChange
}: UseChatRuntimeStateParams) {
  const [scrollToBottomOnSend] = usePreference('chat.message.scroll_to_bottom_on_send')
  const [autoReadEnabled] = usePreference('feature.voice.auto_read.enabled')
  const { regenerate, stop, activeExecutions, projection } = useChatWithHistory(topic.id, refresh)
  const { status: streamStatus, isPending: isTopicStreamPending } = useTopicStreamStatus(topic.id)
  const isTopicAwaitingApproval = useTopicAwaitingApproval(topic.id)
  const messages = uiMessages
  const invalidateCache = useInvalidateCache()
  const errorToastsRef = useRef<ReturnType<typeof useConversationErrorToasts> | null>(null)
  const messageListRuntimeRef = useRef<MessageListRuntime | null>(null)
  const bindMessageListRuntime = useCallback((runtime: MessageListRuntime) => {
    messageListRuntimeRef.current = runtime
    return () => {
      if (messageListRuntimeRef.current === runtime) {
        messageListRuntimeRef.current = null
      }
    }
  }, [])
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => messageListRuntimeRef.current?.scrollToBottom())
  }, [])
  const locateMessage = useCallback((messageId: string | null, highlight?: boolean) => {
    if (messageId === null) messageListRuntimeRef.current?.scrollToBottom()
    else dispatchLocateMessage(messageListRuntimeRef.current, messageId, highlight)
  }, [])

  const [branchLiveMessages, setBranchLiveMessages] = useState<CherryUIMessage[]>([])
  const [branchLiveExecutions, setBranchLiveExecutions] = useState<ActiveExecution[]>([])
  const [branchLiveActiveNodeOverride, setBranchLiveActiveNodeOverride] = useState<{
    previousActiveNodeId: string | null
    activeNodeId: string
  } | null>(null)
  const finishedBranchExecutionKeysRef = useRef<Set<number>>(new Set())
  const runtimeBranchLiveStatePublishedRef = useRef(false)
  // Ref-guarded against <Activity> re-show: hide/show re-runs this effect with
  // an unchanged topic.id, and the fresh [] literals would defeat React's
  // setState bail-out and force a full chat-runtime re-render per tab switch.
  const branchLiveResetTopicIdRef = useRef(topic.id)
  useEffect(() => {
    if (branchLiveResetTopicIdRef.current === topic.id) return
    branchLiveResetTopicIdRef.current = topic.id
    finishedBranchExecutionKeysRef.current.clear()
    runtimeBranchLiveStatePublishedRef.current = false
    setBranchLiveMessages([])
    setBranchLiveExecutions([])
    setBranchLiveActiveNodeOverride(null)
  }, [topic.id])
  useEffect(() => {
    setBranchLiveActiveNodeOverride((current) =>
      current && current.previousActiveNodeId !== activeNodeId ? null : current
    )
  }, [activeNodeId])
  const branchActiveExecutions = useMemo(
    () => mergeActiveExecutions([...activeExecutions], branchLiveExecutions),
    [activeExecutions, branchLiveExecutions]
  )
  const branchActiveExecutionsRef = useRef(branchActiveExecutions)
  branchActiveExecutionsRef.current = branchActiveExecutions
  useEffect(() => {
    const activeKeys = new Set(branchActiveExecutions.map(executionAttemptKey))
    for (const key of finishedBranchExecutionKeysRef.current) {
      if (!activeKeys.has(key)) {
        finishedBranchExecutionKeysRef.current.delete(key)
      }
    }
  }, [branchActiveExecutions])

  const finishRef = useRef<((executionId: string, event: ExecutionFinishEvent) => void) | undefined>(undefined)
  const liveAssistants = useHistoryReplies(projection, branchActiveExecutions, replyHistory, streamStatus)
  useTopicSpeech(topic.id, branchActiveExecutions, autoReadEnabled, (_executionId, event) =>
    autoReadService.update({
      ...event,
      enabled: autoReadEnabled,
      scope: topic.id,
      eligible: (event.type === 'snapshot' ? event.message.id : event.messageId) === branchFlowActiveNodeIdRef.current
    })
  )
  useTopicCompletion(topic.id, branchActiveExecutions, (executionId, event) => {
    errorToastsRef.current?.onFinish(executionId, event)
    finishRef.current?.(executionId, event)
  })

  const persistedPartsByMessageId = useMemo(() => createPartsByMessageId(messages), [messages])
  const partsByMessageId = useMemo(
    () => replyParts(persistedPartsByMessageId, liveAssistants),
    [persistedPartsByMessageId, liveAssistants]
  )
  const liveMessageIds = useStableStringArray(activeReplyIds(branchActiveExecutions, liveAssistants))
  const streamingLayers = useMemo(
    () => ({ historyPartsByMessageId: persistedPartsByMessageId, liveMessageIds }),
    [persistedPartsByMessageId, liveMessageIds]
  )
  const activeAwaitingInputMessageId = useMemo(() => {
    const index = activeNodeId ? displayIndex(activeNodeId) : undefined
    const active = index === undefined ? undefined : messages[index]
    return active && !isRenderableConversationMessage(active) ? active.id : null
  }, [activeNodeId, displayIndex, messages])
  const composerChatTarget = useMemo<ComposerChatTarget>(
    () => ({
      parentAnchorId: activeNodeId,
      mode: activeAwaitingInputMessageId ? 'reserved-branch' : 'active-path'
    }),
    [activeAwaitingInputMessageId, activeNodeId]
  )
  const visibleHistory = useMemo(() => {
    if (messages.every(isRenderableConversationMessage)) return { messages, displayIndex }
    const visible = messages.filter(isRenderableConversationMessage)
    const positions = new Map(visible.map((message, index) => [message.id, index]))
    return { messages: visible, displayIndex: (id: string) => positions.get(id) }
  }, [messages, displayIndex])
  const displayMessages = useMemo(
    () => mergeLiveReplies(visibleHistory.messages, liveAssistants, visibleHistory.displayIndex, 'append'),
    [visibleHistory, liveAssistants]
  )

  // Tool-approval card surface. Awaiting-approval tools render `null` inline
  // (see MessageMcpTool / AgentExecutionTimeline), so the composer override is
  // the only approve/deny UI. The bridge delivers each queue-head decision to
  // main; MessageService publishes every committed change so the next card
  // comes from refreshed DB state, then Main starts the continuation after
  // every approval settles.
  const respondToolApproval = useToolApprovalBridge(topic.id)
  const toolApprovalComposerOverrides = useToolApprovalComposerOverrides({
    topicId: topic.id,
    partsByMessageId,
    persistedPartsByMessageId,
    streamingLayers,
    onRespond: respondToolApproval
  })
  const composerContext = useMemo<ComposerContextValue>(
    () => ({ overrides: toolApprovalComposerOverrides }),
    [toolApprovalComposerOverrides]
  )

  const cache = useTopicMessagesCache({ topicId: topic.id, mutate: messagesCacheMutate })
  const seedMessagesCache = cache.seedReservedMessages
  const seedReservedMessages = useCallback(
    async (reservedMessages: CherryUIMessage[], options: ReservedMessageSeedOptions = {}) => {
      const { activeExecutions: openedExecutions, preserveActiveNode } = options
      errorToastsRef.current?.track(openedExecutions, reservedMessages)
      if (reservedMessages.length > 0) {
        const reservedExecutions = openedExecutions ?? []
        if (reservedExecutions.length > 0) {
          for (const execution of reservedExecutions) {
            finishedBranchExecutionKeysRef.current.delete(executionAttemptKey(execution))
          }
          setBranchLiveExecutions((current) => mergeActiveExecutions(current, reservedExecutions))
        }
        setBranchLiveMessages((current) => mergeMessagesById(current, reservedMessages))
        if (!preserveActiveNode) {
          const reservedActiveNodeId = reservedMessages.at(-1)?.id
          if (reservedActiveNodeId) {
            setBranchLiveActiveNodeOverride({ previousActiveNodeId: activeNodeId, activeNodeId: reservedActiveNodeId })
          }
        }
      }
      await seedMessagesCache(reservedMessages, { preserveActiveNode })
    },
    [activeNodeId, seedMessagesCache]
  )
  const ensureConversation = useCallback(
    async ({ options }: ChatTurnInput) => {
      if (isHistoryLoading) return null

      return {
        topicId: topic.id,
        parentAnchorId: options?.chatTarget ? options.chatTarget.parentAnchorId : (activeNodeId ?? null)
      }
    },
    [activeNodeId, isHistoryLoading, topic.id]
  )
  const buildStreamRequest = useCallback(
    ({ text, options }: ChatTurnInput, conversation: { topicId: string; parentAnchorId: string | null }) => {
      const requestOptions = {
        topicId: conversation.topicId,
        mentionedModelIds: options?.mentionedModels,
        reasoningEffort: options?.reasoningEffort,
        serviceTier: options?.serviceTier,
        ...(options?.fastMode ? { fastMode: true as const } : {})
      }

      return {
        ...requestOptions,
        trigger: 'submit-message' as const,
        parentAnchorId: conversation.parentAnchorId ?? undefined,
        userMessageParts: options?.userMessageParts ?? [{ type: 'text' as const, text }],
        ...(options?.chatTarget ? { targetMode: options.chatTarget.mode } : {})
      }
    },
    []
  )
  const refreshMetadata = useCallback(
    ({ topicId }: { topicId: string }) => invalidateCache(['/topics', `/topics/${topicId}`]),
    [invalidateCache]
  )
  const { phase: turnPhase, send } = useConversationTurnController<
    ChatTurnInput,
    { topicId: string; parentAnchorId: string | null }
  >({
    scopeKey: topic.id,
    onRollback: cache.rollbackBranch,
    ensureConversation,
    buildStreamRequest,
    refreshMetadata,
    onAccepted: (ack) => {
      if (!ack.reservedMessages?.length) {
        errorToastsRef.current?.track(ack.activeExecutions, ack.reservedMessages)
        return
      }
      return seedReservedMessages(ack.reservedMessages, ack)
    },
    onError: (error, input) =>
      errorToastsRef.current?.report(
        error,
        input.options?.mentionedModels?.length === 1
          ? input.options.mentionedModels[0]
          : (composerModelId ?? assistant?.modelId ?? undefined)
      )
  })

  const activeStreamingMessageIds = useMemo(() => new Set(liveMessageIds), [liveMessageIds])
  const activeAnchorMessages = useMemo(
    () =>
      liveMessageIds
        .flatMap((id) => displayIndex(id) ?? [])
        .sort((a, b) => a - b)
        .map((index) => messages[index]),
    [displayIndex, liveMessageIds, messages]
  )
  const branchFlowLiveMessages = useMemo(
    () => projectBranchFlowMessages(branchLiveMessages, activeAnchorMessages, liveAssistants),
    [activeAnchorMessages, branchLiveMessages, liveAssistants]
  )
  const branchFlowActiveNodeId =
    branchLiveActiveNodeOverride?.previousActiveNodeId === activeNodeId
      ? branchLiveActiveNodeOverride.activeNodeId
      : activeNodeId
  const branchFlowActiveNodeIdRef = useRef(branchFlowActiveNodeId)
  branchFlowActiveNodeIdRef.current = branchFlowActiveNodeId

  useEffect(() => {
    if (!onBranchLiveStateChange) return

    if (branchActiveExecutions.length === 0 && branchFlowLiveMessages.length === 0) {
      if (runtimeBranchLiveStatePublishedRef.current) {
        runtimeBranchLiveStatePublishedRef.current = false
        onBranchLiveStateChange(null)
      }
      return
    }

    const liveState = buildTopicMessageFlowLiveState({
      topicId: topic.id,
      messages: branchFlowLiveMessages,
      partsByMessageId,
      // Ordinary reservations optimistically activate their persisted branch before the cache
      // catches up. In-place retry/live-group append do not create this override, and a persisted
      // or user-selected active node immediately supersedes it.
      activeNodeId: branchFlowActiveNodeId,
      streamingMessageIds: activeStreamingMessageIds
    })

    if (!liveState) {
      if (runtimeBranchLiveStatePublishedRef.current) {
        runtimeBranchLiveStatePublishedRef.current = false
        onBranchLiveStateChange(null)
      }
      return
    }

    runtimeBranchLiveStatePublishedRef.current = true
    onBranchLiveStateChange(liveState)
  }, [
    branchFlowActiveNodeId,
    branchActiveExecutions.length,
    activeStreamingMessageIds,
    branchFlowLiveMessages,
    onBranchLiveStateChange,
    partsByMessageId,
    topic.id
  ])

  const handleExecutionFinish = useCallback(
    (executionId: string, { attemptId, message, isAbort, isError }: ExecutionFinishEvent) => {
      void autoReadService.consume({
        enabled: autoReadEnabled,
        message,
        attemptId,
        isAbort,
        isError,
        eligible: message.id === branchFlowActiveNodeIdRef.current
      })
      const finishedKey = attemptId
      const treeCachePath = `/topics/${topic.id}/tree`
      void (async () => {
        try {
          await invalidateCache(treeCachePath)
        } catch (err) {
          logger.warn('failed to reconcile topic branch flow after execution finish', err as Error)
        } finally {
          finishedBranchExecutionKeysRef.current.add(finishedKey)
          const replacementIsLive = branchActiveExecutionsRef.current.some(
            (execution) =>
              execution.executionId === executionId &&
              execution.anchorMessageId === message.id &&
              executionAttemptKey(execution) !== finishedKey
          )
          setBranchLiveExecutions((current) =>
            current.filter((execution) => executionAttemptKey(execution) !== finishedKey)
          )
          if (!replacementIsLive) {
            const hasRemainingExecutions = branchActiveExecutionsRef.current.some(
              (execution) => !finishedBranchExecutionKeysRef.current.has(executionAttemptKey(execution))
            )
            if (hasRemainingExecutions) {
              setBranchLiveMessages((current) => current.filter((item) => item.id !== message.id))
            } else {
              setBranchLiveMessages([])
              setBranchLiveActiveNodeOverride(null)
              runtimeBranchLiveStatePublishedRef.current = false
              onBranchLiveStateChange?.(null)
            }
          }
        }
      })()
    },
    [autoReadEnabled, invalidateCache, onBranchLiveStateChange, topic.id]
  )
  finishRef.current = handleExecutionFinish

  const shouldRenderHomeComposer = false
  const isTurnBusy =
    isTopicStreamPending || isTopicAwaitingApproval || turnPhase === 'persisting' || turnPhase === 'opening'

  const { actions: chatWriteActions, retryFailedMessage } = useChatWriteActions({
    topic,
    uiMessages: messages,
    activeNodeId,
    regenerate,
    stop,
    refresh,
    cache,
    seedReservedMessages,
    scrollToBottom,
    startNewContextBlocked: isHistoryLoading || isTurnBusy,
    assistant,
    composerModelId
  })
  const errorToasts = useConversationErrorToasts(topic.id, {
    retry: retryFailedMessage,
    trimContext: async () => {
      if (!chatWriteActions.canStartNewContext || isTopicStreamPending) return false
      const activeMessage = messages.find((message) => message.id === activeNodeId)
      if (hasClearContextPart(activeMessage?.parts)) return false
      await chatWriteActions.startNewContext()
      return true
    }
  })
  errorToastsRef.current = errorToasts

  const sendMessage = useCallback(
    async (text: string, options?: ChatTurnInput['options']) => {
      try {
        const sent = await send({ text, options })
        if (sent && scrollToBottomOnSend) scrollToBottom()
        return sent
      } catch (err) {
        logger.warn('failed to open conversation turn', err as Error)
        throw err
      }
    },
    [scrollToBottom, scrollToBottomOnSend, send]
  )

  return {
    messages: displayMessages,
    partsByMessageId,
    streamingLayers,
    isTurnBusy,
    shouldRenderHomeComposer,
    chatWriteActions,
    bindMessageListRuntime,
    locateMessage,
    sendMessage,
    composerChatTarget,
    composerContext
  }
}
