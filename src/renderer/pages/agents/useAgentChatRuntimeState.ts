import { isToolUIPart } from 'ai'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import {
  createOverlayRefreshHandoff,
  useMessageStreamingLayers
} from '@renderer/components/chat/messages/stream/useMessageStreamingLayers'
import {
  isAskUserQuestionToolName,
  parseAskUserQuestionToolInput
} from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import type {
  MessageListSelectAllPagination,
  MessageStreamingLayers,
  MessageToolApprovalInput
} from '@renderer/components/chat/messages/types'
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
import { invalidateCachedMessageUiStates } from '@renderer/services/messageUiStateCache'
import { toast } from '@renderer/services/toast'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { formatErrorMessage } from '@renderer/utils/error'
import { mergeMessagesById } from '@renderer/utils/message/mergeMessagesById'
import type { AgentSessionEditDraft, AgentSessionEditTarget } from '@shared/ai/agentSessionEdit'
import { agentSessionEditFailureReasons } from '@shared/ai/agentSessionEdit'
import type { AiStreamOpenRequest, AiToolApprovalRespondResponse } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { aiErrorCodes, agentSessionForkFailureReason } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'

import { agentSessionForkReasonLabel } from './messages/agentSessionFork'

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
  editTarget?: AgentSessionEditTarget
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
  selectAllPagination?: MessageListSelectAllPagination
  isPending: boolean
  stop: () => Promise<void>
  sendMessage: (message?: { text: string }, options?: AgentSendOptions) => Promise<boolean>
  deleteMessage: (messageId: string) => Promise<void>
  respondToolApproval: (input: MessageToolApprovalInput) => Promise<void>
  composerContext: ComposerContextValue
  editing?: AgentSessionEditDraft
  editBusy: boolean
  startEditing: (messageId: string) => Promise<void>
  cancelEditing: () => void
  resendEditedMessage: AgentChatRuntimeState['sendMessage']
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
  const { t } = useTranslation()
  const [editDraft, setEditDraft] = useState<AgentSessionEditDraft & { sessionId: string }>()
  const editing = editDraft?.sessionId === sessionId ? editDraft : undefined
  const [editPending, setEditPending] = useState(false)
  const [resendingHistory, setResendingHistory] = useState<{ sessionId: string; messages: CherryUIMessage[] }>()
  const optimisticMessages = resendingHistory?.sessionId === sessionId ? resendingHistory.messages : undefined
  const editRequestRef = useRef(false)
  const currentSessionRef = useRef(sessionId)
  currentSessionRef.current = sessionId
  const reportEditError = useCallback(
    (error: unknown) => {
      const forkReason = agentSessionForkFailureReason(error)
      const reason =
        error instanceof IpcError &&
        error.code === aiErrorCodes.AI_AGENT_SESSION_EDIT_FAILED &&
        error.data &&
        typeof error.data === 'object' &&
        'reason' in error.data
          ? error.data.reason
          : undefined
      const editReason = agentSessionEditFailureReasons.find((candidate) => candidate === reason)
      toast.error(
        editReason
          ? t(`agent.edit_resend.error.${editReason}`)
          : forkReason
            ? agentSessionForkReasonLabel(t, forkReason)
            : formatErrorMessage(error)
      )
    },
    [t]
  )
  const sessionTopicId = useMemo(() => (sessionId ? buildAgentSessionTopicId(sessionId) : ''), [sessionId])
  const {
    messages: uiMessages,
    isLoading,
    hasOlder,
    loadOlder,
    selectAllPagination,
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
      serviceTier: input.options?.body?.serviceTier,
      ...(input.options?.body?.fastMode === true ? { fastMode: true } : {})
    }),
    []
  )
  const { send } = useConversationTurnController<AgentTurnInput, { topicId: string }>({
    scopeKey: sessionTopicId,
    historyAdapter,
    ensureConversation,
    buildStreamRequest,
    openStream: async (request, input) => {
      if (!input.editTarget || request.trigger !== 'submit-message') return ipcApi.request('ai.stream.open', request)
      const ack = await ipcApi.request('ai.agent.session.edit_resend', {
        sessionId,
        target: { messageId: input.editTarget.messageId, version: input.editTarget.version },
        userMessageParts: request.userMessageParts,
        reasoningEffort: request.reasoningEffort,
        serviceTier: request.serviceTier,
        fastMode: request.fastMode
      })
      if (ack.mode !== 'blocked' && currentSessionRef.current === sessionId) {
        resetOverlay()
        setMessages([])
        await Promise.resolve(refresh()).catch((error) =>
          loggerService.withContext('AgentEdit').warn('Failed to refresh edited history', { error })
        )
      }
      return ack
    }
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

  const {
    overlay,
    liveAssistants,
    reset: resetOverlay
  } = useExecutionOverlay(sessionTopicId, activeExecutions, uiMessages)
  const { partsByMessageId, streamingLayers } = useMessageStreamingLayers({
    messages: optimisticMessages ?? uiMessages,
    overlay,
    executions: activeExecutions,
    liveAssistants
  })
  const [optimisticAskUserQuestionInputsByToolCallId, setOptimisticAskUserQuestionInputsByToolCallId] = useState<
    Record<string, unknown>
  >({})

  // Deterministic overlay→DB handoff at terminal (see hook docs).
  useTopicOverlayHandoffOnTerminal(sessionTopicId, createOverlayRefreshHandoff(refresh, resetOverlay))

  // Ref-guarded against <Activity> re-show: hide/show re-runs this effect with
  // an unchanged sessionTopicId, and the fresh {} literal would defeat React's
  // setState bail-out and force a re-render on every tab switch.
  const optimisticInputsResetTopicIdRef = useRef(sessionTopicId)
  useEffect(() => {
    if (optimisticInputsResetTopicIdRef.current === sessionTopicId) return
    optimisticInputsResetTopicIdRef.current = sessionTopicId
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

  const displayMessages = useMemo(
    () => optimisticMessages ?? mergeMessagesById(uiMessages, liveAssistants),
    [liveAssistants, optimisticMessages, uiMessages]
  )

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
  const editBusy = isPending || editPending || toolApprovalComposerOverrides.length > 0
  const cancelEditing = useCallback(() => {
    if (!editRequestRef.current) setEditDraft(undefined)
  }, [])
  const startEditing = useCallback(
    async (messageId: string) => {
      if (editBusy || editRequestRef.current) return
      editRequestRef.current = true
      setEditPending(true)
      try {
        const draft = await ipcApi.request('ai.agent.session.edit_target', { sessionId, messageId })
        if (currentSessionRef.current === sessionId) setEditDraft({ ...draft, sessionId })
      } catch (error) {
        if (currentSessionRef.current === sessionId) reportEditError(error)
      } finally {
        editRequestRef.current = false
        setEditPending(false)
      }
    },
    [editBusy, reportEditError, sessionId]
  )
  const resendEditedMessage = useCallback<AgentChatRuntimeState['sendMessage']>(
    async (message, options) => {
      if (!editing || editBusy || editRequestRef.current) return false
      editRequestRef.current = true
      setEditPending(true)
      const input = { text: message?.text ?? '', options, editTarget: editing }
      const index = uiMessages.findIndex((item) => item.id === editing.messageId)
      if (index >= 0) {
        setResendingHistory({
          sessionId,
          messages: [...uiMessages.slice(0, index), { ...uiMessages[index], parts: getAgentTurnParts(input) }]
        })
      }
      try {
        const sent = await send(input)
        if (sent && currentSessionRef.current === sessionId) setEditDraft(undefined)
        return sent
      } catch (error) {
        if (currentSessionRef.current === sessionId) reportEditError(error)
        return false
      } finally {
        setResendingHistory(undefined)
        editRequestRef.current = false
        setEditPending(false)
      }
    },
    [editBusy, editing, reportEditError, send, sessionId, uiMessages]
  )

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
    selectAllPagination,
    isPending,
    stop,
    sendMessage,
    deleteMessage,
    respondToolApproval,
    composerContext,
    editing,
    editBusy,
    startEditing,
    cancelEditing,
    resendEditedMessage
  }
}
