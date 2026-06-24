import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { ComposerContextValue } from '@renderer/components/chat/composer/ComposerContext'
import { useToolApprovalComposerOverrides } from '@renderer/components/chat/composer/useToolApprovalComposerOverrides'
import { type TranslationOverlayEntry, type TranslationOverlaySetter } from '@renderer/components/chat/messages/blocks'
import {
  buildTopicMessageFlowLiveState,
  type TopicMessageFlowLiveState
} from '@renderer/components/chat/messages/flow/topicMessageFlowLiveTree'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import {
  type ConversationHistoryAdapter,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { type ExecutionFinishEvent, useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useToolApprovalBridge } from '@renderer/hooks/useToolApprovalBridge'
import { useTopicOverlayHandoffOnTerminal } from '@renderer/hooks/useTopicStreamStatus'
import type { Topic } from '@renderer/types'
import { mergeMessagesById } from '@renderer/utils/message/mergeMessagesById'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useChatWriteActions } from './hooks/useChatWriteActions'
import { useStablePartsByMessageId } from './hooks/useStablePartsByMessageId'
import { useTopicMessagesCache, type UseTopicMessagesCacheParams } from './hooks/useTopicMessagesCache'

const logger = loggerService.withContext('useChatRuntimeState')

export interface ChatTurnInput {
  text: string
  options?: {
    mentionedModels?: UniqueModelId[]
    knowledgeBaseIds?: string[]
    userMessageParts?: CherryMessagePart[]
  }
}

interface UseChatRuntimeStateParams {
  topic: Topic
  isHistoryLoading: boolean
  initialMessages: CherryUIMessage[]
  uiMessages: CherryUIMessage[]
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
  /** Topic's virtual-root id — authoritative first-turn signal (parentId === rootId). */
  rootId: string | null
  messagesCacheMutate: UseTopicMessagesCacheParams['mutate']
  onBranchLiveStateChange?: (state: TopicMessageFlowLiveState | null) => void
  clearBranchDraft?: () => void
  getBranchDraftAnchorId?: () => string | null
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
  rootId,
  messagesCacheMutate,
  onBranchLiveStateChange,
  clearBranchDraft,
  getBranchDraftAnchorId
}: UseChatRuntimeStateParams) {
  const { regenerate, stop, setMessages, activeExecutions } = useChatWithHistory(topic.id, initialMessages, refresh)
  const messages = uiMessages
  const invalidateCache = useInvalidateCache()

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

  // Deterministic overlay→DB handoff at terminal (see hook docs). The overlay's
  // `onFinish` is suppressed when an execution leaves `activeExecutions`, so a
  // torn-down turn's live card would otherwise override the finalized DB row.
  // Refresh-then-dispose off the status edge; branch-rollback/bookkeeping stays
  // in `handleExecutionFinish`. Excludes awaiting-approval (card must remain).
  useTopicOverlayHandoffOnTerminal(topic.id, async () => {
    try {
      await refresh()
    } finally {
      resetOverlay()
    }
  })

  const partsByMessageId = useStablePartsByMessageId(messages, overlay, translationOverlay)
  const displayMessages = useMemo(() => mergeMessagesById(messages, liveAssistants), [messages, liveAssistants])

  // Tool-approval card surface. Awaiting-approval tools render `null` inline
  // (see MessageMcpTool / AgentExecutionTimeline), so the composer override is
  // the only approve/deny UI. The bridge just delivers the decision to main;
  // the card hides optimistically and the live stream pushes the continuation.
  const respondToolApproval = useToolApprovalBridge(topic.id)
  const toolApprovalComposerOverrides = useToolApprovalComposerOverrides({
    partsByMessageId,
    onRespond: respondToolApproval
  })
  const composerContext = useMemo<ComposerContextValue>(
    () => ({ overrides: toolApprovalComposerOverrides }),
    [toolApprovalComposerOverrides]
  )

  const cache = useTopicMessagesCache({ topicId: topic.id, mutate: messagesCacheMutate })
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
      await cache.seedReservedMessages(reservedMessages)
    },
    [cache.seedReservedMessages]
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
    ensureConversation: async () => {
      if (isHistoryLoading) return null
      const parentAnchorId = getBranchDraftAnchorId?.() ?? activeNodeId ?? null
      return { topicId: topic.id, parentAnchorId }
    },
    buildStreamRequest: ({ text, options }, conversation) => ({
      trigger: 'submit-message',
      topicId: conversation.topicId,
      parentAnchorId: conversation.parentAnchorId ?? undefined,
      userMessageParts: options?.userMessageParts ?? [{ type: 'text', text }],
      mentionedModelIds: options?.mentionedModels
    }),
    refreshMetadata: ({ topicId }) => invalidateCache(['/topics', `/topics/${topicId}`])
  })

  const activeStreamingMessageIds = useMemo(
    () =>
      new Set([
        ...branchActiveExecutions.flatMap((execution) =>
          execution.anchorMessageId ? [execution.anchorMessageId] : []
        ),
        ...liveAssistants.map((message) => message.id)
      ]),
    [branchActiveExecutions, liveAssistants]
  )
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
          } else {
            await refresh()
          }
          await invalidateCache(treeCachePath)
        } catch (err) {
          logger.warn('failed to reconcile topic branch flow after execution finish', err as Error)
        } finally {
          finishedBranchExecutionIdsRef.current.add(executionId)
          disposeOverlay(message.id)
          setBranchLiveExecutions((current) => current.filter((execution) => execution.executionId !== executionId))
          const hasRemainingExecutions = branchActiveExecutions.some(
            (execution) => !finishedBranchExecutionIdsRef.current.has(execution.executionId)
          )
          if (hasRemainingExecutions) {
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
    rootId,
    regenerate,
    setMessages,
    stop,
    refresh,
    cache,
    seedReservedMessages
  })

  const sendMessage = useCallback(
    async (text: string, options?: ChatTurnInput['options']) => {
      try {
        const ack = await turnController.send({ text, options })
        if (ack?.mode === 'started') {
          clearBranchDraft?.()
        }
      } catch (err) {
        logger.warn('failed to open conversation turn', err as Error)
        throw err
      }
    },
    [clearBranchDraft, turnController]
  )

  return {
    messages: displayMessages,
    partsByMessageId,
    shouldRenderHomeComposer,
    chatWriteActions,
    sendMessage,
    composerContext,
    translationOverlay,
    setTranslationOverlay
  }
}
