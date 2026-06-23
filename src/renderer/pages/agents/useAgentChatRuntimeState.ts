import { loggerService } from '@logger'
import type { ComposerContextValue } from '@renderer/components/chat/composer/ComposerContext'
import { useToolApprovalComposerOverrides } from '@renderer/components/chat/composer/useToolApprovalComposerOverrides'
import {
  isAskUserQuestionToolName,
  parseAskUserQuestionToolInput
} from '@renderer/components/chat/messages/tools/agent/types'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import { useAgentSessionParts } from '@renderer/hooks/useAgentSessionParts'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import {
  type ConversationHistoryAdapter,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { type ExecutionFinishEvent, useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useTopicOverlayHandoffOnTerminal, useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { GetAgentResponse } from '@renderer/types'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { mergeMessagesById } from '@renderer/utils/message/mergeMessagesById'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import { isToolUIPart } from 'ai'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('useAgentChatRuntimeState')

type AskUserQuestionApprovalPart = CherryMessagePart & {
  type?: string
  toolName?: string
  toolCallId?: string
  input?: unknown
  output?: unknown
}

export type AgentSendOptions = { body?: Record<string, unknown> }

export interface AgentTurnInput {
  text: string
  options?: AgentSendOptions
}

export function getAgentTurnParts(input: AgentTurnInput): CherryMessagePart[] {
  const parts = input.options?.body?.userMessageParts as CherryMessagePart[] | undefined
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
  optimisticAskUserQuestionInputsByToolCallId: Record<string, unknown>
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
  const {
    overlay,
    liveAssistants,
    disposeOverlay,
    reset: resetOverlay
  } = useExecutionOverlay(sessionTopicId, chat.activeExecutions, uiMessages, {
    onFinish: (executionId, event) => finishRef.current?.(executionId, event)
  })
  const [optimisticAskUserQuestionInputsByToolCallId, setOptimisticAskUserQuestionInputsByToolCallId] = useState<
    Record<string, unknown>
  >({})

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

  // Deterministic overlay→DB handoff: the overlay's `onFinish` is suppressed when
  // the execution leaves `activeExecutions` at terminal, so a torn-down turn's
  // live card would otherwise override the finalized DB row. Refresh then drop the
  // overlay off the terminal status edge (excludes awaiting-approval, which keeps
  // its card). `refresh()` before `reset()` avoids flashing the stale base parts.
  useTopicOverlayHandoffOnTerminal(sessionTopicId, async () => {
    try {
      await refresh()
    } finally {
      resetOverlay()
    }
  })

  useEffect(() => {
    setOptimisticAskUserQuestionInputsByToolCallId({})
  }, [sessionTopicId])

  const partsByMessageId = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next = { ...basePartsMap }
    for (const [messageId, parts] of Object.entries(overlay)) {
      if (parts.length) next[messageId] = parts
    }
    return next
  }, [basePartsMap, overlay])

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

      let result: Awaited<ReturnType<typeof window.api.ai.toolApproval.respond>>
      try {
        result = await window.api.ai.toolApproval.respond({
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
    optimisticAskUserQuestionInputsByToolCallId,
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
