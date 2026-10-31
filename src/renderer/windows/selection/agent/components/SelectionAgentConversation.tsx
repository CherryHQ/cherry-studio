import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { ChatSidePaddingProvider } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import { createComposerUserMessageParts } from '@renderer/components/composer/composerDraft'
import type { ComposerSerializedDraft } from '@renderer/components/composer/tokens'
import {
  getAgentDraftCacheKey,
  toConversationDraft
} from '@renderer/components/composer/variants/agent/agentDraftCache'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentWorkspaceWarning } from '@renderer/hooks/agent/useAgentWorkspaceWarning'
import { useSession } from '@renderer/hooks/agent/useSession'
import { useModelById } from '@renderer/hooks/useModel'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { ipcApi } from '@renderer/ipc'
import AgentComposerSlot from '@renderer/pages/agents/AgentComposerSlot'
import AgentSessionMessages from '@renderer/pages/agents/components/AgentSessionMessages'
import { useAgentChatRuntimeState } from '@renderer/pages/agents/useAgentChatRuntimeState'
import { handOffAgentDraft } from '@renderer/services/agentDraftHandoff'
import { toast } from '@renderer/services/toast'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { getSelectionAgentIssue } from '@renderer/utils/selectionAction'
import { classifyTurn } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'

import { useSelectionAgentWindowRules } from '../useSelectionAgentWindowRules'
import { SelectionAgentHeader } from './SelectionAgentHeader'

const logger = loggerService.withContext('SelectionAgentConversation')

const NO_RESERVED_MESSAGES: CherryUIMessage[] = []
// Even with the composer's bottom margin, so the small window has one inset on every edge.
const SIDE_PADDING_PX = 12
// Ends message text at the composer's send button, balancing the avatar column on the left.
const MESSAGE_END_INSET_PX = 12

interface SelectionAgentConversationProps {
  sessionId: string
  firstMessage: ComposerSerializedDraft
  isPinned: boolean
  onTogglePin: () => void
  opacity: number
  onOpacityChange: (opacity: number) => void
}

/** The session's messages and composer, sending the first message once the agent can run it. */
export const SelectionAgentConversation: FC<SelectionAgentConversationProps> = ({
  sessionId,
  firstMessage,
  ...headerProps
}) => {
  const { t } = useTranslation()
  const { session } = useSession(sessionId)
  const { agent, isLoading: agentLoading } = useAgent(session?.agentId ?? null)
  const { model } = useModelById(agent?.model)
  const workspacePath = session?.workspace?.type === 'user' ? session.workspace.path : undefined
  const workspaceWarning = useAgentWorkspaceWarning(workspacePath)
  const runtime = useAgentChatRuntimeState({
    sessionId,
    modelId: model?.id,
    agentType: agent?.type,
    sessionMessagesEnabled: Boolean(session),
    sessionHistoryFetchOnMount: true,
    reservedMessages: NO_RESERVED_MESSAGES
  })

  // A recreated Cherry Assistant may still have no usable model; the first message waits until one is set.
  const missingModel = Boolean(agent && !agentLoading && getSelectionAgentIssue(agent) === 'no_model')
  const firstMessageSentRef = useRef(false)
  const { sendMessage } = runtime
  useEffect(() => {
    if (firstMessageSentRef.current || !session || !agent || !model) return
    firstMessageSentRef.current = true
    const userMessageParts = createComposerUserMessageParts(firstMessage)
    void sendMessage({ text: firstMessage.text }, { body: { agentId: agent.id, sessionId, userMessageParts } }).then(
      // A rejected send saved nothing, so the composer gets the message back to retry.
      (sent) => sent || handOffAgentDraft(sessionId, { ...firstMessage, files: [], knowledgeBaseIds: [] })
    )
  }, [agent, firstMessage, model, sendMessage, session, sessionId])

  // Until the first turn shows up the window is still starting, even though nothing streams yet.
  const { status } = useTopicStreamStatus(buildAgentSessionTopicId(sessionId))
  const [turnSeen, setTurnSeen] = useState(false)
  if (status && !turnSeen) setTurnSeen(true)
  const turn = classifyTurn(status)
  const [draft] = useCache(getAgentDraftCacheKey(sessionId))
  const hasDraft = Boolean(draft.text.trim() || draft.tokens.length || draft.files.length)
  useSelectionAgentWindowRules({
    // An edit of a sent message is unsaved work too, though it never reaches the draft cache.
    idle: turnSeen && !turn.isTurnActive && !hasDraft && !runtime.editing,
    pinned: headerProps.isPinned,
    onEscape: turn.isStreamLive ? () => void runtime.stop() : undefined
  })

  // The main window composer receives the unsent draft; this window closes only once it has landed.
  const openInMainWindow = async () => {
    try {
      await ipcApi.request('navigation.focus_or_open_conversation', {
        target: { conversationType: 'agent', conversationId: sessionId },
        title: session?.name || agent?.name || '',
        ...(hasDraft && { draft: await toConversationDraft(draft) })
      })
      void ipcApi.request('window.close')
    } catch (error) {
      logger.error('Failed to open the session in the main window', error as Error)
      toast.error(t('selection.agent.open_in_main_window_failed'))
    }
  }

  return (
    <ChatSidePaddingProvider sidePaddingPx={SIDE_PADDING_PX} messageEndInsetPx={MESSAGE_END_INSET_PX}>
      <div className="flex h-full min-h-0 flex-col">
        <SelectionAgentHeader
          avatar={agent ? getAgentAvatarFromConfiguration(agent.configuration) : undefined}
          title={agent?.name ?? ''}
          subtitle={session?.name || undefined}
          onOpenInMainWindow={() => void openInMainWindow()}
          {...headerProps}
        />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {session && (
            <AgentSessionMessages
              agentId={agent?.id}
              sessionId={runtime.sessionId}
              messages={runtime.uiMessages}
              activeAgent={agent}
              partsByMessageId={runtime.partsByMessageId}
              streamingLayers={runtime.streamingLayers}
              optimisticAskUserQuestionInputsByToolCallId={runtime.optimisticAskUserQuestionInputsByToolCallId}
              isLoading={runtime.isLoading}
              hasOlder={runtime.hasOlder}
              loadOlder={runtime.loadOlder}
              selectAllPagination={runtime.selectAllPagination}
              deleteMessage={runtime.deleteMessage}
              startEditing={runtime.startEditing}
              editBusy={runtime.editBusy}
              respondToolApproval={runtime.respondToolApproval}
            />
          )}
        </div>
        {missingModel && agent && (
          <div className="px-3 pb-2 text-warning text-xs">
            {t('selection.agent.no_model_notice', { name: agent.name })}
          </div>
        )}
        {session && (
          <AgentComposerSlot
            agentId={agent?.id}
            activeAgent={agent}
            activeModel={model}
            workspaceWarning={workspaceWarning}
            isMultiSelectMode={false}
            session={session}
            sessionId={runtime.sessionId}
            sendMessage={runtime.sendMessage}
            stop={runtime.stop}
            isStreaming={runtime.isPending}
            sendDisabled={!agent}
            composerContext={runtime.composerContext}
            editing={runtime.editing}
            editBusy={runtime.editBusy}
            cancelEditing={runtime.cancelEditing}
            resendEditedMessage={runtime.resendEditedMessage}
            steerWhileBusy
          />
        )}
      </div>
    </ChatSidePaddingProvider>
  )
}
