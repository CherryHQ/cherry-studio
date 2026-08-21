import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
// eslint-disable-next-line barrel/closed -- Bypass the flow barrel so chat startup does not touch TopicMessageFlowCanvas.
import {
  buildTopicMessageFlowLiveState,
  type TopicMessageFlowLiveState
} from '@renderer/components/chat/flow/topicMessageFlowLiveTree'
import {
  type TranslationOverlayEntry,
  type TranslationOverlaySetter
} from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import { useMessageStreamingLayers } from '@renderer/components/chat/messages/stream/useMessageStreamingLayers'
import type { MessageListRuntime } from '@renderer/components/chat/messages/types'
import { dispatchLocateMessage } from '@renderer/components/chat/messages/utils/dispatchLocateMessage'
import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import { useToolApprovalComposerOverrides } from '@renderer/components/composer/useToolApprovalComposerOverrides'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import { useConversationStreamStatus } from '@renderer/hooks/useConversationStreamStatus'
import {
  type ConversationHistoryAdapter,
  type ReservedMessageSeedOptions,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { type ExecutionFinishEvent, useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useToolApprovalBridge } from '@renderer/hooks/useToolApprovalBridge'
import type { Assistant } from '@renderer/types/assistant'
import type { Topic } from '@renderer/types/topic'
import { mergeMessagesById } from '@renderer/utils/message/mergeMessagesById'
import { isRenderableConversationMessage } from '@renderer/utils/message/messageProjection'
import { ConversationKind, ConversationOpenTrigger, ConversationTargetMode } from '@shared/ai/conversation'
import type { ComposerChatTarget } from '@shared/ai/transport'
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

export interface TopicBranchLiveContribution {
  topicId: string
  state: TopicMessageFlowLiveState | null
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
  onBranchLiveStateChange?: (contribution: TopicBranchLiveContribution) => void
}

function projectBranchFlowMessages(
  optimisticReservations: CherryUIMessage[],
  persistedMessages: CherryUIMessage[],
  liveMessages: CherryUIMessage[]
): CherryUIMessage[] {
  return mergeMessagesById(optimisticReservations, persistedMessages, liveMessages)
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
  const conversation = useMemo(() => ({ kind: ConversationKind.Chat, id: topic.id }) as const, [topic.id])
  const { regenerate, stop, setMessages, activeExecutions } = useChatWithHistory(conversation, initialMessages, refresh)
  const { conversationBusy } = useConversationStreamStatus(conversation)
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

  const cache = useTopicMessagesCache({ topicId: topic.id, mutate: messagesCacheMutate })
  const handleExecutionFinish = useCallback(
    (_executionId: string, { message, isError }: ExecutionFinishEvent) => {
      const treeCachePath = `/topics/${topic.id}/tree`
      void (async () => {
        try {
          if (isError || !message.parts?.length) await cache.rollbackBranch()
          await invalidateCache(treeCachePath)
        } catch (err) {
          logger.warn('failed to reconcile topic branch flow after execution finish', err as Error)
        }
      })()
    },
    [cache, invalidateCache, topic.id]
  )
  const {
    overlay,
    liveAssistants,
    optimisticMessages,
    projectedExecutions,
    activeNodeOverride,
    seedReservations: seedProjectionReservations
  } = useExecutionOverlay(conversation, activeExecutions, messages, {
    onFinish: handleExecutionFinish,
    refreshOnQuiesced: refresh
  })

  const { partsByMessageId, liveMessageIds, streamingLayers } = useMessageStreamingLayers({
    messages,
    overlay,
    executions: projectedExecutions,
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
      mode: activeAwaitingInputMessageId ? ConversationTargetMode.ReservedBranch : ConversationTargetMode.ActivePath
    }),
    [activeAwaitingInputMessageId, activeNodeId]
  )
  const displayMessages = useMemo(
    () => mergeMessagesById(messages.filter(isRenderableConversationMessage), liveAssistants),
    [messages, liveAssistants]
  )

  // Tool-approval card surface. Awaiting-approval tools render `null` inline
  // (see MessageMcpTool / AgentExecutionTimeline), so the composer override is
  // the only approve/deny UI. The bridge delivers each queue-head decision to
  // main; MessageService publishes every committed change so the next card
  // comes from refreshed DB state, then Main starts the continuation after
  // every approval settles.
  const respondToolApproval = useToolApprovalBridge(conversation)
  const toolApprovalComposerOverrides = useToolApprovalComposerOverrides({
    partsByMessageId,
    streamingLayers,
    onRespond: respondToolApproval
  })
  const composerContext = useMemo<ComposerContextValue>(
    () => ({ overrides: toolApprovalComposerOverrides }),
    [toolApprovalComposerOverrides]
  )

  const seedMessagesCache = cache.seedReservedMessages
  const seedReservedMessages = useCallback(
    async (reservedMessages: CherryUIMessage[], options: ReservedMessageSeedOptions = {}) => {
      const { activeExecutions: openedExecutions, activeNodeDecision } = options
      if (reservedMessages.length > 0) {
        seedProjectionReservations(reservedMessages, openedExecutions ?? [], activeNodeDecision, activeNodeId)
      }
      await seedMessagesCache(reservedMessages, { activeNodeDecision })
    },
    [activeNodeId, seedMessagesCache, seedProjectionReservations]
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
        conversation: { kind: ConversationKind.Chat, id: conversation.topicId } as const,
        mentionedModelIds: options?.mentionedModels,
        reasoningEffort: options?.reasoningEffort,
        ...(options?.fastMode ? { fastMode: true as const } : {})
      }

      return {
        ...requestOptions,
        trigger: ConversationOpenTrigger.SubmitMessage,
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
    () => projectBranchFlowMessages(optimisticMessages, activeAnchorMessages, liveAssistants),
    [activeAnchorMessages, liveAssistants, optimisticMessages]
  )
  const branchFlowActiveNodeId =
    activeNodeOverride?.previousActiveNodeId === activeNodeId ? activeNodeOverride.activeNodeId : activeNodeId

  useEffect(() => {
    if (!onBranchLiveStateChange) return

    if (projectedExecutions.length === 0 && branchFlowLiveMessages.length === 0) {
      onBranchLiveStateChange({ topicId: topic.id, state: null })
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
      onBranchLiveStateChange({ topicId: topic.id, state: null })
      return
    }

    onBranchLiveStateChange({ topicId: topic.id, state: liveState })
  }, [
    branchFlowActiveNodeId,
    projectedExecutions.length,
    activeStreamingMessageIds,
    branchFlowLiveMessages,
    onBranchLiveStateChange,
    partsByMessageId,
    topic.id
  ])

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
      conversationBusy ||
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
