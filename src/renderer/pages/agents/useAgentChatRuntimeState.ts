import { loggerService } from '@logger'
import type { ComposerContextValue } from '@renderer/components/chat/composer/ComposerContext'
import { useToolApprovalComposerOverrides } from '@renderer/components/chat/composer/useToolApprovalComposerOverrides'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import { useAgentSessionParts } from '@renderer/hooks/useAgentSessionParts'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import {
  type ConversationHistoryAdapter,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { type ExecutionFinishEvent, useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { GetAgentResponse } from '@renderer/types'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useAgentChatRuntimeState')

export type AgentSendOptions = { body?: Record<string, unknown> }

export interface AgentTurnInput {
  text: string
  options?: AgentSendOptions
}

export function getAgentTurnParts(input: AgentTurnInput): CherryMessagePart[] {
  const parts = input.options?.body?.userMessageParts as CherryMessagePart[] | undefined
  return parts ?? (input.text ? [{ type: 'text', text: input.text }] : [])
}

export interface AgentChatRuntimeState {
  sessionId: string
  uiMessages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  isLoading: boolean
  hasOlder?: boolean
  loadOlder?: () => void
  fallbackSnapshot?: ModelSnapshot
  isPending: boolean
  stop: () => Promise<void>
  sendMessage: (message?: { text: string }, options?: AgentSendOptions) => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  respondToolApproval: (input: MessageToolApprovalInput) => Promise<void>
  composerContext: ComposerContextValue
}

interface UseAgentChatRuntimeStateParams {
  session: AgentSessionEntity
  activeAgent: GetAgentResponse | undefined
  sessionMessagesEnabled: boolean
  sessionHistoryFetchOnMount?: boolean
  reservedMessages: CherryUIMessage[]
}

export function useAgentChatRuntimeState({
  session,
  activeAgent,
  sessionMessagesEnabled,
  sessionHistoryFetchOnMount,
  reservedMessages
}: UseAgentChatRuntimeStateParams): AgentChatRuntimeState {
  const { t } = useTranslation()
  const sessionId = session.id
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const {
    messages: uiMessages,
    isLoading,
    hasOlder,
    loadOlder,
    refresh,
    seedReservedMessages,
    deleteMessage: deleteSessionMessage
  } = useAgentSessionParts(sessionId, {
    enabled: sessionMessagesEnabled,
    fetchOnMount: sessionHistoryFetchOnMount
  })

  useLayoutEffect(() => {
    if (!sessionMessagesEnabled || reservedMessages.length === 0) return
    void seedReservedMessages(reservedMessages)
  }, [reservedMessages, seedReservedMessages, sessionMessagesEnabled])

  const chat = useChatWithHistory(sessionTopicId, uiMessages, refresh)
  const historyAdapter = useMemo<ConversationHistoryAdapter>(
    () => ({
      seedReservedMessages,
      refresh,
      rollback: refresh
    }),
    [refresh, seedReservedMessages]
  )
  const turnController = useConversationTurnController<AgentTurnInput, { topicId: string }>({
    scopeKey: sessionTopicId,
    historyAdapter,
    ensureConversation: () => ({ topicId: sessionTopicId }),
    buildStreamRequest: (input, conversation) => ({
      trigger: 'submit-message',
      topicId: conversation.topicId,
      userMessageParts: getAgentTurnParts(input)
    })
  })
  const sendMessage = useCallback(
    async (message?: { text: string }, options?: AgentSendOptions) => {
      await turnController.send({ text: message?.text ?? '', options })
    },
    [turnController]
  )
  const deleteMessage = useCallback(
    async (messageId: string) => {
      await deleteSessionMessage(messageId)
      chat.setMessages((current) => current.filter((message) => message.id !== messageId))
    },
    [chat, deleteSessionMessage]
  )

  const fallbackSnapshot = useMemo<ModelSnapshot | undefined>(() => {
    const modelString = activeAgent?.model
    if (!isUniqueModelId(modelString)) return undefined
    const { providerId, modelId } = parseUniqueModelId(modelString)
    if (!providerId || !modelId) return undefined
    return { id: modelId, name: activeAgent?.modelName ?? modelId, provider: providerId }
  }, [activeAgent?.model, activeAgent?.modelName])

  const basePartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next: Record<string, CherryMessagePart[]> = {}
    for (const message of uiMessages) {
      next[message.id] = (message.parts ?? []) as CherryMessagePart[]
    }
    return next
  }, [uiMessages])

  const finishRef = useRef<((executionId: string, event: ExecutionFinishEvent) => void) | undefined>(undefined)
  const { overlay, disposeOverlay } = useExecutionOverlay(sessionTopicId, chat.activeExecutions, uiMessages, {
    onFinish: (executionId, event) => finishRef.current?.(executionId, event)
  })

  const handleExecutionFinish = useCallback(
    (_executionId: string, { message }: ExecutionFinishEvent) => {
      void (async () => {
        try {
          await refresh()
        } catch (error) {
          logger.warn('Failed to refresh agent messages after execution finish', { sessionId, error })
        } finally {
          if (message.id) disposeOverlay(message.id)
        }
      })()
    },
    [disposeOverlay, refresh, sessionId]
  )
  finishRef.current = handleExecutionFinish

  const partsByMessageId = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next = { ...basePartsMap }
    for (const [messageId, parts] of Object.entries(overlay)) {
      if (parts.length) next[messageId] = parts
    }
    return next
  }, [basePartsMap, overlay])

  const respondToolApproval = useCallback(
    async ({ match, approved, reason, updatedInput }: MessageToolApprovalInput) => {
      const approvalId = match.approvalId

      const result = await window.api.ai.toolApproval.respond({
        approvalId,
        approved,
        reason,
        updatedInput,
        topicId: sessionTopicId,
        anchorId: match.messageId
      })

      if (!result.ok) throw new Error('Tool approval response was not accepted')
      if (result.status === 'expired') {
        window.toast.warning(t('agent.toolPermission.toast.timeout'))
      }
      await refresh()
    },
    [refresh, sessionTopicId, t]
  )
  const toolApprovalComposerOverrides = useToolApprovalComposerOverrides({
    partsByMessageId,
    onRespond: respondToolApproval
  })
  const { isPending } = useTopicStreamStatus(sessionTopicId)

  const composerContext = useMemo<ComposerContextValue>(
    () => ({
      overrides: toolApprovalComposerOverrides
    }),
    [toolApprovalComposerOverrides]
  )

  return {
    sessionId,
    uiMessages,
    partsByMessageId,
    isLoading,
    hasOlder,
    loadOlder,
    fallbackSnapshot,
    isPending,
    stop: chat.stop,
    sendMessage,
    deleteMessage,
    respondToolApproval,
    composerContext
  }
}
