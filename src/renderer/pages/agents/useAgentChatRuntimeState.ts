import { isToolUIPart } from 'ai'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { useAgentSessionBackgroundTasks } from '@renderer/hooks/agent/useAgentSessionBackgroundTasks'
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
import { mergeMessagesById } from '@renderer/utils/message/mergeMessagesById'
import type { AgentSessionEditReason, AgentSessionEditTarget } from '@shared/ai/agentSessionEdit'
import { AGENT_SESSION_PENDING_INPUT_COUNT_KEY } from '@shared/ai/agentSessionEdit'
import type { AiStreamOpenRequest, AiToolApprovalRespondResponse } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { agentSessionEditFailureReason } from '@shared/ipc/errors/ai'

const editErrorKeys = {
  source_missing: 'agent.edit_resend.error.source_missing',
  not_last_user_message: 'agent.edit_resend.error.not_last_user_message',
  busy: 'agent.edit_resend.error.busy',
  history_changed: 'agent.edit_resend.error.history_changed',
  invalid_mapping: 'agent.edit_resend.error.invalid_mapping',
  attachment_unavailable: 'agent.edit_resend.error.attachment_unavailable',
  input_unsupported: 'agent.edit_resend.error.input_unsupported',
  operation_conflict: 'agent.edit_resend.error.operation_conflict',
  send_uncertain: 'agent.edit_resend.error.send_uncertain',
  close_failed: 'agent.edit_resend.error.close_failed'
} as const satisfies Record<AgentSessionEditReason, string>

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
  edit?: AgentSessionEditTarget
}

export interface AgentMessageEdit extends AgentSessionEditTarget {
  sessionId: string
  parts: CherryMessagePart[]
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
  editBusy: boolean
  stop: () => Promise<void>
  sendMessage: (message?: { text: string }, options?: AgentSendOptions) => Promise<boolean>
  deleteMessage: (messageId: string) => Promise<void>
  respondToolApproval: (input: MessageToolApprovalInput) => Promise<void>
  composerContext: ComposerContextValue
  editing?: AgentMessageEdit
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
  const pendingInputCount = useSharedCacheValue(AGENT_SESSION_PENDING_INPUT_COUNT_KEY(sessionId)) ?? 0
  const backgroundTasks = useAgentSessionBackgroundTasks(sessionId)
  const [editing, setEditing] = useState<AgentMessageEdit>()
  const editSubmissionRef = useRef<{ key: string; operationId: string } | undefined>(undefined)
  const scopeRef = useRef(sessionId)
  scopeRef.current = sessionId
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
  const openStream = useCallback(
    async (input: AgentTurnInput, request: AiStreamOpenRequest) => {
      if (!input.edit) return ipcApi.request('ai.stream.open', request)
      const result = await ipcApi.request('ai.agent.session.edit_resend', {
        sessionId,
        ...input.edit,
        userMessageParts: getAgentTurnParts(input),
        reasoningEffort: input.options?.body?.reasoningEffort,
        serviceTier: input.options?.body?.serviceTier,
        fastMode: input.options?.body?.fastMode
      })
      if (result.mode !== 'blocked') await refresh().catch(() => undefined)
      return result
    },
    [sessionId, refresh]
  )
  const { send } = useConversationTurnController<AgentTurnInput, { topicId: string }>({
    scopeKey: sessionTopicId,
    historyAdapter,
    ensureConversation,
    buildStreamRequest,
    openStream
  })
  const startEditing = useCallback(
    async (messageId: string) => {
      if (editing?.sessionId === sessionId && editing.messageId === messageId) return
      if (pendingInputCount > 0 || backgroundTasks.length > 0) {
        toast.error(t('agent.edit_resend.error.busy'))
        return
      }
      try {
        const snapshot = await ipcApi.request('ai.agent.session.edit_snapshot', { sessionId, messageId })
        if (scopeRef.current !== sessionId) return
        editSubmissionRef.current = undefined
        setEditing({ sessionId, messageId, ...snapshot, operationId: crypto.randomUUID() })
      } catch (error) {
        const reason = agentSessionEditFailureReason(error)
        toast.error(reason ? t(editErrorKeys[reason]) : t('chat.input.send_failed'))
      }
    },
    [sessionId, t, editing, pendingInputCount, backgroundTasks.length]
  )
  const cancelEditing = useCallback(() => setEditing(undefined), [])
  const resendEditedMessage = useCallback(
    async (message?: { text: string }, options?: AgentSendOptions) => {
      if (!editing || editing.sessionId !== sessionId) return false
      const key = JSON.stringify({ editing: editing.operationId, message, options })
      if (editSubmissionRef.current?.key !== key) editSubmissionRef.current = { key, operationId: crypto.randomUUID() }
      try {
        const sent = await send({
          text: message?.text ?? '',
          options,
          edit: {
            messageId: editing.messageId,
            version: editing.version,
            operationId: editSubmissionRef.current.operationId
          }
        })
        if (sent) setEditing((current) => (current === editing ? undefined : current))
        return sent
      } catch (error) {
        const reason = agentSessionEditFailureReason(error)
        toast.error(reason ? t(editErrorKeys[reason]) : t('chat.input.send_failed'))
        return false
      }
    },
    [editing, send, sessionId, t]
  )
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
    selectAllPagination,
    isPending,
    editBusy: isPending || pendingInputCount > 0 || backgroundTasks.length > 0,
    stop,
    sendMessage,
    deleteMessage,
    respondToolApproval,
    composerContext,
    editing: editing?.sessionId === sessionId ? editing : undefined,
    startEditing,
    cancelEditing,
    resendEditedMessage
  }
}
