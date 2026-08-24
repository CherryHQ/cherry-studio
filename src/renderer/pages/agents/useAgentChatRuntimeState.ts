import { useMessageStreamingLayers } from '@renderer/components/chat/messages/stream/useMessageStreamingLayers'
import {
  isAskUserQuestionToolName,
  parseAskUserQuestionToolInput
} from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import type { MessageStreamingLayers, MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import { useToolApprovalComposerOverrides } from '@renderer/components/composer/useToolApprovalComposerOverrides'
import type { AgentComposerSendOptions } from '@renderer/components/composer/variants/AgentComposer'
import { useAgentSessionParts } from '@renderer/hooks/useAgentSessionParts'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import { useConversationStreamStatus } from '@renderer/hooks/useConversationStreamStatus'
import {
  type ConversationHistoryAdapter,
  type ReservedMessageSeedOptions,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { ipcApi } from '@renderer/ipc'
import { ConversationOverlayDurability } from '@renderer/services/aiTransport'
import { invalidateCachedMessageUiStates } from '@renderer/services/messageUiStateCache'
import { mergeMessagesById } from '@renderer/utils/message/mergeMessagesById'
import { ConversationKind, ConversationOpenTrigger, conversationRefKey } from '@shared/ai/conversation'
import type { AiStreamOpenRequest, AiToolApprovalRespondResponse } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { isToolUIPart } from 'ai'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

type AskUserQuestionApprovalPart = CherryMessagePart & {
  type?: string
  toolName?: string
  toolCallId?: string
  input?: unknown
  output?: unknown
}

const EMPTY_OPTIMISTIC_INPUTS: Record<string, unknown> = {}

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
    isAskUserQuestionToolName(getToolNameFromPart(input.match.part as AskUserQuestionApprovalPart)) &&
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
  sendMessage: (message?: { text: string }, options?: AgentSendOptions) => Promise<boolean>
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
  const conversation = useMemo(() => ({ kind: ConversationKind.Agent, id: sessionId }) as const, [sessionId])
  const scopeKey = conversationRefKey(conversation)
  const {
    messages: uiMessages,
    isLoading,
    hasOlder,
    loadOlder,
    refresh,
    seedReservedMessages: seedSessionMessages,
    deleteMessage: deleteSessionMessage
  } = useAgentSessionParts(sessionId, {
    enabled: sessionMessagesEnabled,
    fetchOnMount: sessionHistoryFetchOnMount
  })

  useLayoutEffect(() => {
    if (!sessionMessagesEnabled || reservedMessages.length === 0) return
    void seedSessionMessages(reservedMessages)
  }, [reservedMessages, seedSessionMessages, sessionMessagesEnabled])

  const { activeExecutions, setMessages, stop } = useChatWithHistory(conversation, uiMessages, refresh)
  const {
    overlay,
    liveAssistants,
    optimisticMessages,
    projectedExecutions,
    seedReservations: seedProjectionReservations
  } = useExecutionOverlay(conversation, activeExecutions, uiMessages, {
    durability: ConversationOverlayDurability.Durable,
    refreshOnQuiesced: refresh
  })
  const seedReservedMessages = useCallback(
    async (messages: CherryUIMessage[], options: ReservedMessageSeedOptions = {}) => {
      seedProjectionReservations(messages, options.activeExecutions ?? [], options.activeNodeDecision, null)
      await seedSessionMessages(messages)
    },
    [seedProjectionReservations, seedSessionMessages]
  )
  const historyAdapter = useMemo<ConversationHistoryAdapter>(
    () => ({
      seedReservedMessages,
      refresh,
      rollback: refresh
    }),
    [refresh, seedReservedMessages]
  )
  const ensureConversation = useCallback(
    () => ({ conversation: { kind: ConversationKind.Agent, id: sessionId } as const }),
    [sessionId]
  )
  const buildStreamRequest = useCallback(
    (
      input: AgentTurnInput,
      target: { conversation: { kind: ConversationKind.Agent; id: string } }
    ): AiStreamOpenRequest => ({
      trigger: ConversationOpenTrigger.SubmitMessage,
      conversation: target.conversation,
      userMessageParts: getAgentTurnParts(input),
      reasoningEffort: input.options?.body?.reasoningEffort,
      serviceTier: input.options?.body?.serviceTier,
      ...(input.options?.body?.fastMode === true ? { fastMode: true } : {})
    }),
    []
  )
  const { send } = useConversationTurnController<
    AgentTurnInput,
    { conversation: { kind: ConversationKind.Agent; id: string } }
  >({
    scopeKey,
    historyAdapter,
    ensureConversation,
    buildStreamRequest
  })
  const sendMessage = useCallback(
    async (message?: { text: string }, options?: AgentSendOptions) => {
      return send({ text: message?.text ?? '', options })
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

  const { partsByMessageId, streamingLayers } = useMessageStreamingLayers({
    messages: uiMessages,
    overlay,
    executions: projectedExecutions,
    liveAssistants
  })
  const [optimisticInputState, setOptimisticInputState] = useState<{
    topicId: string
    inputs: Record<string, unknown>
  }>(() => ({ topicId: scopeKey, inputs: {} }))
  const optimisticAskUserQuestionInputsByToolCallId =
    optimisticInputState.topicId === scopeKey ? optimisticInputState.inputs : EMPTY_OPTIMISTIC_INPUTS
  const updateOptimisticInputs = useCallback(
    (update: (current: Record<string, unknown>) => Record<string, unknown>) => {
      setOptimisticInputState((current) => {
        const inputs = current.topicId === scopeKey ? current.inputs : {}
        const next = update(inputs)
        return current.topicId === scopeKey && next === inputs ? current : { topicId: scopeKey, inputs: next }
      })
    },
    [scopeKey]
  )

  useEffect(() => {
    updateOptimisticInputs((current) => {
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
  }, [partsByMessageId, updateOptimisticInputs])

  const removeOptimisticAskUserQuestionInput = useCallback(
    (toolCallId: string) => {
      updateOptimisticInputs((current) => {
        if (!(toolCallId in current)) return current
        const next = { ...current }
        delete next[toolCallId]
        return next
      })
    },
    [updateOptimisticInputs]
  )

  const displayMessages = useMemo(
    () => mergeMessagesById(uiMessages, optimisticMessages, liveAssistants),
    [liveAssistants, optimisticMessages, uiMessages]
  )

  const respondToolApproval = useCallback(
    async (input: MessageToolApprovalInput) => {
      const { match, approved, reason, updatedInput } = input
      const approvalId = match.approvalId
      const optimisticToolCallId = isAskUserQuestionApprovalResponse(input) ? match.toolCallId : undefined

      if (optimisticToolCallId) {
        updateOptimisticInputs((current) => ({
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
          conversation,
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
    [conversation, refresh, removeOptimisticAskUserQuestionInput, updateOptimisticInputs]
  )
  const toolApprovalComposerOverrides = useToolApprovalComposerOverrides({
    partsByMessageId,
    streamingLayers,
    onRespond: respondToolApproval
  })
  const { conversationBusy } = useConversationStreamStatus(conversation)

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
    isPending: conversationBusy,
    stop,
    sendMessage,
    deleteMessage,
    respondToolApproval,
    composerContext
  }
}
