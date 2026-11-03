import type { FC } from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentWorkspaceWarning } from '@renderer/hooks/agent/useAgentWorkspaceWarning'
import { useSession } from '@renderer/hooks/agent/useSession'
import { useModelById } from '@renderer/hooks/useModel'
import AgentComposerSlot from '@renderer/pages/agents/AgentComposerSlot'
import AgentSessionMessages from '@renderer/pages/agents/components/AgentSessionMessages'
import { useAgentChatRuntimeState } from '@renderer/pages/agents/useAgentChatRuntimeState'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { getSelectionAgentIssue } from '@renderer/utils/selectionAction'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { SelectionAgentHeader } from './SelectionAgentHeader'

const NO_RESERVED_MESSAGES: CherryUIMessage[] = []

export interface SelectionAgentFirstMessage {
  text: string
  /** Composer-built parts that keep the quote token; plain prompts send as text. */
  userMessageParts?: CherryMessagePart[]
}

interface SelectionAgentConversationProps {
  sessionId: string
  firstMessage: SelectionAgentFirstMessage
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
    const { text, userMessageParts } = firstMessage
    void sendMessage(
      { text },
      userMessageParts ? { body: { agentId: agent.id, sessionId, userMessageParts } } : undefined
    )
  }, [agent, firstMessage, model, sendMessage, session, sessionId])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SelectionAgentHeader
        avatar={agent ? getAgentAvatarFromConfiguration(agent.configuration) : undefined}
        title={agent?.name ?? ''}
        subtitle={session?.name || undefined}
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
        <div className="px-4 pb-2 text-warning text-xs">
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
  )
}
