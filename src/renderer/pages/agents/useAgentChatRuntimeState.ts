import { isToolUIPart } from 'ai'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

import {
  createOverlayRefreshHandoff,
  useMessageStreamingLayers
} from '@renderer/components/chat/messages/stream/useMessageStreamingLayers'
import {
  isAskUserQuestionToolName,
  parseAskUserQuestionToolInput
} from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import type { MessageStreamingLayers, MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import { invalidateCachedMessageUiStates } from '@renderer/components/chat/messages/utils/messageUiStateCache'
import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import { useToolApprovalComposerOverrides } from '@renderer/components/composer/useToolApprovalComposerOverrides'
import type { AgentComposerSendOptions } from '@renderer/components/composer/variants/AgentComposer'
import { useAgentSessionParts } from '@renderer/hooks/useAgentSessionParts'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import {
  type ConversationHistoryAdapter,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useTopicOverlayHandoffOnTerminal, useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { ipcApi } from '@renderer/ipc'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { mergeMessagesById } from '@renderer/utils/message/mergeMessagesById'
import type { AiStreamOpenRequest, AiToolApprovalRespondResponse } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

type AskUserQuestionApprovalPart = CherryMessagePart & {
  type?: string
  toolName?: string
  toolCallId?: string
  input?: unknown
  output?: unknown
}

export type AgentSendOptions = AgentComposerSendOptions

export interface AgentTurnInput {
  text: string
  options?: AgentSendOptions
}

export function getAgentTurnParts(input: AgentTurnInput): CherryMessagePart[] {
  const parts = input.options?.body?.userMessageParts
  return parts ?? (input.text ? [{ type: 'text', text: input.text }] : [])
}

function getToolNameFromPart(part: AskUserQuestionApprovalPart): string {
  if (part.toolName?.trim()) return part.toolName
  if (part.type?.startsWith('tool-')) return part.type.replace(/^tool-/, '')
  return ''
}

function isAskUserQuestionApprovalResponse(input: MessageToolApprovalInput): input is MessageToolApprovalInput & {
  approved: true
  updatedInput: Record<string, unknown>
} {
  return (
    input.approved === true &&
    !!input.updatedInput &&
    isAskUserQuestionToolName(getToolNameFromPart(input.match.part)) &&
    !!parseAskUserQuestionToolInput(input.updatedInput)?.answers
  )
}

function getAskUserQuestionAnswers(value: unknown): Record<string, string> | undefined {
  const answers = parseAskUserQuestionToolInput(value)?.answers
  return answers && Object.keys(answers).length > 0 ? answers : undefined
}

function hasAskUserQuestionAnswers(part: AskUserQuestionApprovalPart): boolean {
  const outputContent =
    typeof part.output === 'object' && part.output !== null && 'content' in part.output
      ? part.output.content
      : undefined
  return !!(
    getAskUserQuestionAnswers(part.input) ??
    getAskUserQuestionAnswers(part.output) ??
    getAskUserQuestionAnswers(outputContent)
  )
}

function findAskUserQuestionPartByCallId(
  partsByMessageId: Record<string, CherryMessagePart[]>,
  toolCallId: string
): AskUserQuestionApprovalPart | undefined {
  for (const parts of Object.values(partsByMessageId)) {
    for (const part of parts) {
      if (!isToolUIPart(part)) continue
      const toolPart = part as AskUserQuestionApprovalPart
      if (toolPart.toolCallId !== toolCallId) continue
      if (!isAskUserQuestionToolName(getToolNameFromPart(toolPart))) continue
      return toolPart
    }
  }
  return undefined
}

export interface AgentChatRuntimeState {
  sessionId: string
  uiMessages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  streamingLayers: MessageStreamingLayers
  optimisticAskUserQuestionInputsByToolCallId: Record<string, unknown>
  isLoading: boolean
  hasOlder?: boolean
  loadOlder?: () => void
  isPending: boolean
  stop: () => Promise<void>
  sendMessage: (message?: { text: string }, options?: AgentSendOptions) => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  respondToolApproval: (input: MessageToolApprovalInput) => Promise<void>
  composerContext: ComposerContextValue
}

interface UseAgentChatRuntimeStateParams {
  sessionId: string
  sessionMessagesEnabled: boolean
  sessionHistoryFetchOnMount?: boolean
  reservedMessages: CherryUIMessage[]
}

export function useAgentChatRuntimeState({
  sessionId,
  sessionMessagesEnabled,
  sessionHistoryFetchOnMount,
  reservedMessages
}: UseAgentChatRuntimeStateParams): AgentChatRuntimeState {
  const sessionTopicId = useMemo(() => (sessionId ? buildAgentSessionTopicId(sessionId) : ''), [sessionId])
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

  const { activeExecutions, setMessages, stop } = useChatWithHistory(sessionTopicId, uiMessages, refresh)
  const historyAdapter = useMemo<ConversationHistoryAdapter>(
    () => ({
      seedReservedMessages,
      refresh,
      rollback: refresh
    }),
    [refresh, seedReservedMessages]
  )
  const ensureConversation = useCallback(() => ({ topicId: sessionTopicId }), [sessionTopicId])
  const buildStreamRequest = useCallback(
    (input: AgentTurnInput, conversation: { topicId: string }): AiStreamOpenRequest => ({
      trigger: 'submit-message',
      topicId: conversation.topicId,
      userMessageParts: getAgentTurnParts(input),
      reasoningEffort: input.options?.body?.reasoningEffort,
      ...(input.options?.body?.fastMode === true ? { fastMode: true } : {})
    }),
    []
  )
  const { send } = useConversationTurnController<AgentTurnInput, { topicId: string }>({
    scopeKey: sessionTopicId,
    historyAdapter,
    ensureConversation,
    buildStreamRequest
  })
  const sendMessage = useCallback(
    async (message?: { text: string }, options?: AgentSendOptions) => {
      await send({ text: message?.text ?? '', options })
    },
    [send]
  )
  const deleteMessage = useCallback(
    async (messageId: string) => {
      await deleteSessionMessage(messageId)
      invalidateCachedMessageUiStates([messageId])
      setMessages((current) => current.filter((message) => message.id !== messageId))
    },
    [deleteSessionMessage, setMessages]
  )

  const {
    overlay,
    liveAssistants,
    reset: resetOverlay
  } = useExecutionOverlay(sessionTopicId, activeExecutions, uiMessages)
  const { partsByMessageId, streamingLayers } = useMessageStreamingLayers({
    messages: uiMessages,
    overlay,
    executions: activeExecutions,
    liveAssistants
  })
  const [optimisticAskUserQuestionInputsByToolCallId, setOptimisticAskUserQuestionInputsByToolCallId] = useState<
    Record<string, unknown>
  >({})

  // Deterministic overlay→DB handoff at terminal (see hook docs).
  useTopicOverlayHandoffOnTerminal(sessionTopicId, createOverlayRefreshHandoff(refresh, resetOverlay))

  useEffect(() => {
    setOptimisticAskUserQuestionInputsByToolCallId({})
  }, [sessionTopicId])

  useEffect(() => {
    setOptimisticAskUserQuestionInputsByToolCallId((current) => {
      let next = current
      let changed = false
      for (const toolCallId of Object.keys(current)) {
        const sourcePart = findAskUserQuestionPartByCallId(partsByMessageId, toolCallId)
        if (!sourcePart || !hasAskUserQuestionAnswers(sourcePart)) continue
        if (!changed) {
          next = { ...current }
          changed = true
        }
        delete next[toolCallId]
      }
      return changed ? next : current
    })
  }, [partsByMessageId])

  const removeOptimisticAskUserQuestionInput = useCallback((toolCallId: string) => {
    setOptimisticAskUserQuestionInputsByToolCallId((current) => {
      if (!(toolCallId in current)) return current
      const next = { ...current }
      delete next[toolCallId]
      return next
    })
  }, [])

  const displayMessages = useMemo(() => mergeMessagesById(uiMessages, liveAssistants), [liveAssistants, uiMessages])

  const respondToolApproval = useCallback(
    async (input: MessageToolApprovalInput) => {
      const { match, approved, reason, updatedInput } = input
      const approvalId = match.approvalId
      const optimisticToolCallId = isAskUserQuestionApprovalResponse(input) ? match.toolCallId : undefined

      if (optimisticToolCallId) {
        setOptimisticAskUserQuestionInputsByToolCallId((current) => ({
          ...current,
          [optimisticToolCallId]: input.updatedInput
        }))
      }

      let result: AiToolApprovalRespondResponse
      try {
        result = await ipcApi.request('ai.tool.respond_approval', {
          approvalId,
          approved,
          reason,
          updatedInput,
          topicId: sessionTopicId,
          anchorId: match.messageId
        })
      } catch (error) {
        if (optimisticToolCallId) removeOptimisticAskUserQuestionInput(optimisticToolCallId)
        throw error
      }

      if (!result.ok) {
        if (optimisticToolCallId) removeOptimisticAskUserQuestionInput(optimisticToolCallId)
        throw new Error('Tool approval response was not accepted')
      }
      await refresh()
    },
    [refresh, removeOptimisticAskUserQuestionInput, sessionTopicId]
  )
  const toolApprovalComposerOverrides = useToolApprovalComposerOverrides({
    partsByMessageId,
    streamingLayers,
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
    uiMessages: displayMessages,
    partsByMessageId,
    streamingLayers,
    optimisticAskUserQuestionInputsByToolCallId,
    isLoading,
    hasOlder,
    loadOlder,
    isPending,
    stop,
    sendMessage,
    deleteMessage,
    respondToolApproval,
    composerContext
  }
}
