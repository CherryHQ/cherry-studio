import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { buildTopicMessageFlowLiveState, type TopicMessageFlowLiveState } from '@renderer/components/chat/flow'
import {
  type TranslationOverlayEntry,
  type TranslationOverlaySetter
} from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import {
  createOverlayRefreshHandoff,
  useMessageStreamingLayers
} from '@renderer/components/chat/messages/stream/useMessageStreamingLayers'
import type { MessageListRuntime } from '@renderer/components/chat/messages/types'
import { dispatchLocateMessage } from '@renderer/components/chat/messages/utils/dispatchLocateMessage'
import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import { useToolApprovalComposerOverrides } from '@renderer/components/composer/useToolApprovalComposerOverrides'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import {
  type ConversationHistoryAdapter,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { type ExecutionFinishEvent, useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useToolApprovalBridge } from '@renderer/hooks/useToolApprovalBridge'
import {
  useTopicAwaitingApproval,
  useTopicOverlayHandoffOnTerminal,
  useTopicStreamStatus
} from '@renderer/hooks/useTopicStreamStatus'
import type { Assistant } from '@renderer/types/assistant'
import type { Topic } from '@renderer/types/topic'
import { mergeMessagesById } from '@renderer/utils/message/mergeMessagesById'
import { isRenderableConversationMessage } from '@renderer/utils/message/messageProjection'
import type { ActiveExecution, ComposerChatTarget } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { isBlankUserTurn } from '@shared/data/types/uiParts'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useChatWriteActions } from './hooks/useChatWriteActions'
import { useTopicMessagesCache, type UseTopicMessagesCacheParams } from './hooks/useTopicMessagesCache'

const logger = loggerService.withContext('useChatRuntimeState')

export interface ChatTurnInput {
  text: string
  options?: {
    mentionedModels?: UniqueModelId[]
    userMessageParts?: CherryMessagePart[]
    reasoningEffort?: ReasoningEffortOption
    fastMode?: boolean
    chatTarget?: ComposerChatTarget
  }
}

interface UseChatRuntimeStateParams {
  topic: Topic
  isHistoryLoading: boolean
  initialMessages: CherryUIMessage[]
  uiMessages: CherryUIMessage[]
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
  messagesCacheMutate: UseTopicMessagesCacheParams['mutate']
  assistant?: Assistant
  onBranchLiveStateChange?: (state: TopicMessageFlowLiveState | null) => void
}

function mergeActiveExecutions(...sources: ActiveExecution[][]): ActiveExecution[] {
  const order: string[] = []
  const byId = new Map<string, ActiveExecution>()

  for (const executions of sources) {
    for (const execution of executions) {
      const existing = byId.get(execution.executionId)
      if (!existing) order.push(execution.executionId)
      byId.set(execution.executionId, {
        ...existing,
        ...execution,
        anchorMessageId: execution.anchorMessageId ?? existing?.anchorMessageId
      })
    }
  }

  return order.flatMap((executionId) => {
    const execution = byId.get(executionId)
    return execution ? [execution] : []
  })
}

function getReservedActiveExecutions(messages: CherryUIMessage[]): ActiveExecution[] {
  const executions: ActiveExecution[] = []
  const seen = new Set<string>()

  for (const message of messages) {
    const executionId = message.role === 'assistant' ? message.metadata?.modelId : undefined
    if (!executionId || seen.has(executionId)) continue
    seen.add(executionId)
    executions.push({ executionId: executionId as ActiveExecution['executionId'], anchorMessageId: message.id })
  }

  return executions
}

export function useChatRuntimeState({
  topic,
  isHistoryLoading,
  initialMessages,
  uiMessages,
  refresh,
  activeNodeId,
  messagesCacheMutate,
  assistant,
  onBranchLiveStateChange
}: UseChatRuntimeStateParams) {
  const { regenerate, stop, setMessages, activeExecutions } = useChatWithHistory(topic.id, initialMessages, refresh)
  const { isPending: isTopicStreamPending } = useTopicStreamStatus(topic.id)
  const isTopicAwaitingApproval = useTopicAwaitingApproval(topic.id)
  const messages = uiMessages
  const invalidateCache = useInvalidateCache()
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
  const locateMessage = useCallback((messageId: string, highlight?: boolean) => {
    dispatchLocateMessage(messageListRuntimeRef.current, messageId, highlight)
  }, [])

  // PR 3: the effect that pushed `uiMessages` into `useChat.setMessages` after
  // every terminal render was the user's banned anti-pattern (effect-driven
  // mutation of SWR-read data into another store). The only consumer that
  // needs `useChat.state.messages` hydrated is `regenerate({ messageId })` for
  // anchor resolution — that snapshot now happens synchronously at the call
  // site inside `chatWriteActions.regenerateWithCapabilities`.

  const [translationOverlay, setTranslationOverlayMap] = useState<Record<string, TranslationOverlayEntry>>({})
  const [branchLiveMessages, setBranchLiveMessages] = useState<CherryUIMessage[]>([])
  const [branchLiveExecutions, setBranchLiveExecutions] = useState<ActiveExecution[]>([])
  const finishedBranchExecutionIdsRef = useRef<Set<string>>(new Set())
  const runtimeBranchLiveStatePublishedRef = useRef(false)
  useEffect(() => {
    finishedBranchExecutionIdsRef.current.clear()
    runtimeBranchLiveStatePublishedRef.current = false
    setBranchLiveMessages([])
    setBranchLiveExecutions([])
  }, [topic.id])
  const setTranslationOverlay = useCallback<TranslationOverlaySetter>((messageId, entry) => {
    setTranslationOverlayMap((prev) => {
      if (entry == null) {
        if (!(messageId in prev)) return prev
        const next = { ...prev }
        delete next[messageId]
        return next
      }
      const existing = prev[messageId]
      if (
        existing &&
        existing.content === entry.content &&
        existing.targetLanguage === entry.targetLanguage &&
        existing.sourceLanguage === entry.sourceLanguage
      ) {
        return prev
      }
      return { ...prev, [messageId]: entry }
    })
  }, [])

  const branchActiveExecutions = useMemo(
    () => mergeActiveExecutions(branchLiveExecutions, [...activeExecutions]),
    [activeExecutions, branchLiveExecutions]
  )

  const finishRef = useRef<((executionId: string, event: ExecutionFinishEvent) => void) | undefined>(undefined)
  const {
    overlay,
    liveAssistants,
    disposeOverlay,
    reset: resetOverlay
  } = useExecutionOverlay(topic.id, branchActiveExecutions, messages, {
    onFinish: (executionId, event) => finishRef.current?.(executionId, event)
  })

  // Deterministic overlay→DB handoff at terminal (see hook docs); branch
  // bookkeeping stays in `handleExecutionFinish`.
  useTopicOverlayHandoffOnTerminal(topic.id, createOverlayRefreshHandoff(refresh, resetOverlay))

  const { partsByMessageId, liveMessageIds, streamingLayers } = useMessageStreamingLayers({
    messages,
    overlay,
    executions: branchActiveExecutions,
    liveAssistants,
    translationOverlay
  })
  const activeAwaitingInputMessageId = useMemo(
    () =>
      activeNodeId
        ? (messages.find(
            (message) =>
              message.id === activeNodeId &&
              isBlankUserTurn({
                role: message.role,
                status: message.metadata?.status,
                parts: message.parts
              })
          )?.id ?? null)
        : null,
    [activeNodeId, messages]
  )
  const composerChatTarget = useMemo<ComposerChatTarget>(
    () => ({
      parentAnchorId: activeNodeId,
      mode: activeAwaitingInputMessageId ? 'reserved-branch' : 'active-path'
    }),
    [activeAwaitingInputMessageId, activeNodeId]
  )
  const displayMessages = useMemo(
    () => mergeMessagesById(messages.filter(isRenderableConversationMessage), liveAssistants),
    [messages, liveAssistants]
  )

  // Tool-approval card surface. Awaiting-approval tools render `null` inline
  // (see MessageMcpTool / AgentExecutionTimeline), so the composer override is
  // the only approve/deny UI. The bridge just delivers the decision to main;
  // the card hides optimistically and the live stream pushes the continuation.
  const respondToolApproval = useToolApprovalBridge(topic.id)
  const toolApprovalComposerOverrides = useToolApprovalComposerOverrides({
    partsByMessageId,
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
    async (reservedMessages: CherryUIMessage[]) => {
      if (reservedMessages.length > 0) {
        const reservedExecutions = getReservedActiveExecutions(reservedMessages)
        if (reservedExecutions.length > 0) {
          for (const execution of reservedExecutions) {
            finishedBranchExecutionIdsRef.current.delete(execution.executionId)
          }
          setBranchLiveExecutions((current) => mergeActiveExecutions(current, reservedExecutions))
        }
        setBranchLiveMessages((current) => mergeMessagesById(current, reservedMessages))
      }
      await seedMessagesCache(reservedMessages)
    },
    [seedMessagesCache]
  )
  const historyAdapter = useMemo<ConversationHistoryAdapter>(
    () => ({
      seedReservedMessages,
      refresh,
      rollback: cache.rollbackBranch
    }),
    [cache.rollbackBranch, refresh, seedReservedMessages]
  )
  const turnController = useConversationTurnController<
    ChatTurnInput,
    { topicId: string; parentAnchorId: string | null }
  >({
    scopeKey: topic.id,
    historyAdapter,
    ensureConversation: async ({ options }) => {
      if (isHistoryLoading) return null

      return {
        topicId: topic.id,
        parentAnchorId: options?.chatTarget ? options.chatTarget.parentAnchorId : (activeNodeId ?? null)
      }
    },
    buildStreamRequest: ({ text, options }, conversation) => {
      const requestOptions = {
        topicId: conversation.topicId,
        mentionedModelIds: options?.mentionedModels,
        reasoningEffort: options?.reasoningEffort,
        ...(options?.fastMode ? { fastMode: true as const } : {})
      }

      return {
        ...requestOptions,
        trigger: 'submit-message',
        parentAnchorId: conversation.parentAnchorId ?? undefined,
        userMessageParts: options?.userMessageParts ?? [{ type: 'text' as const, text }],
        ...(options?.chatTarget ? { targetMode: options.chatTarget.mode } : {})
      }
    },
    refreshMetadata: ({ topicId }) => invalidateCache(['/topics', `/topics/${topicId}`])
  })

  const activeStreamingMessageIds = useMemo(() => new Set(liveMessageIds), [liveMessageIds])
  const activeAnchorMessages = useMemo(
    () => messages.filter((message) => activeStreamingMessageIds.has(message.id)),
    [activeStreamingMessageIds, messages]
  )
  const branchFlowLiveMessages = useMemo(
    () => mergeMessagesById(branchLiveMessages, activeAnchorMessages, liveAssistants),
    [activeAnchorMessages, branchLiveMessages, liveAssistants]
  )

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
      activeNodeId: branchFlowLiveMessages.at(-1)?.id ?? activeNodeId,
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
    activeNodeId,
    branchActiveExecutions.length,
    activeStreamingMessageIds,
    branchFlowLiveMessages,
    onBranchLiveStateChange,
    partsByMessageId,
    topic.id
  ])

  const handleExecutionFinish = useCallback(
    (executionId: string, { message, isError }: ExecutionFinishEvent) => {
      const treeCachePath = `/topics/${topic.id}/tree`
      void (async () => {
        try {
          if (isError || !message.parts?.length) {
            await cache.rollbackBranch()
          }
          await invalidateCache(treeCachePath)
        } catch (err) {
          logger.warn('failed to reconcile topic branch flow after execution finish', err as Error)
        } finally {
          finishedBranchExecutionIdsRef.current.add(executionId)
          setBranchLiveExecutions((current) => current.filter((execution) => execution.executionId !== executionId))
          const hasRemainingExecutions = branchActiveExecutions.some(
            (execution) => !finishedBranchExecutionIdsRef.current.has(execution.executionId)
          )
          if (hasRemainingExecutions) {
            if (!isError && message.parts?.length) {
              try {
                await refresh()
              } catch (err) {
                logger.warn('failed to refresh messages after branch execution finish', err as Error)
              }
            }
            disposeOverlay(message.id)
            setBranchLiveMessages((current) => current.filter((item) => item.id !== message.id))
          } else {
            setBranchLiveMessages([])
            runtimeBranchLiveStatePublishedRef.current = false
            onBranchLiveStateChange?.(null)
          }
        }
      })()
    },
    [branchActiveExecutions, cache, disposeOverlay, invalidateCache, onBranchLiveStateChange, refresh, topic.id]
  )
  finishRef.current = handleExecutionFinish

  const shouldRenderHomeComposer = false

  const { actions: chatWriteActions } = useChatWriteActions({
    topic,
    uiMessages: messages,
    activeNodeId,
    regenerate,
    setMessages,
    stop,
    refresh,
    cache,
    seedReservedMessages,
    scrollToBottom,
    startNewContextBlocked:
      isHistoryLoading ||
      isTopicStreamPending ||
      isTopicAwaitingApproval ||
      turnController.phase === 'persisting' ||
      turnController.phase === 'opening',
    assistant
  })

  const sendMessage = useCallback(
    async (text: string, options?: ChatTurnInput['options']) => {
      try {
        await turnController.send({ text, options })
      } catch (err) {
        logger.warn('failed to open conversation turn', err as Error)
        throw err
      }
    },
    [turnController]
  )

  return {
    messages: displayMessages,
    partsByMessageId,
    streamingLayers,
    shouldRenderHomeComposer,
    chatWriteActions,
    bindMessageListRuntime,
    locateMessage,
    sendMessage,
    composerChatTarget,
    composerContext,
    translationOverlay,
    setTranslationOverlay
  }
}
