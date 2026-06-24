import type { ConversationComposerPlacement } from '@renderer/components/chat/composer/ConversationComposerStage'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import type { Citation, GetAgentResponse } from '@renderer/types'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import type { ComponentProps } from 'react'

import { useAgentRightPaneActions } from './components/AgentRightPane'
import AgentSessionMessages from './components/AgentSessionMessages'

interface AgentChatMainProps {
  placement: ConversationComposerPlacement
  sessionMessagesEnabled: boolean
  agentId?: string
  sessionId: string
  messages: CherryUIMessage[]
  activeAgent: GetAgentResponse | undefined
  partsByMessageId: Record<string, CherryMessagePart[]>
  optimisticAskUserQuestionInputsByToolCallId: Record<string, unknown>
  modelFallback?: ModelSnapshot
  isLoading: boolean
  hasOlder?: boolean
  loadOlder?: () => void
  onOpenCitationsPanel: (payload: { citations: Citation[] }) => void
  deleteMessage: (messageId: string) => Promise<void>
  respondToolApproval: (input: MessageToolApprovalInput) => Promise<void>
}

export default function AgentChatMain({
  placement,
  sessionMessagesEnabled,
  agentId,
  sessionId,
  messages,
  activeAgent,
  partsByMessageId,
  optimisticAskUserQuestionInputsByToolCallId,
  modelFallback,
  isLoading,
  hasOlder,
  loadOlder,
  onOpenCitationsPanel,
  deleteMessage,
  respondToolApproval
}: AgentChatMainProps) {
  if (placement !== 'docked' || !sessionMessagesEnabled) {
    return <div className="h-full min-h-0 flex-1" />
  }

  return (
    <div className="translate-z-0 relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        <AgentSessionMessagesWithAgentRightPaneAction
          agentId={agentId}
          sessionId={sessionId}
          messages={messages}
          activeAgent={activeAgent}
          partsByMessageId={partsByMessageId}
          optimisticAskUserQuestionInputsByToolCallId={optimisticAskUserQuestionInputsByToolCallId}
          modelFallback={modelFallback}
          isLoading={isLoading}
          hasOlder={hasOlder}
          loadOlder={loadOlder}
          onOpenCitationsPanel={onOpenCitationsPanel}
          deleteMessage={agentId ? deleteMessage : undefined}
          respondToolApproval={agentId ? respondToolApproval : undefined}
        />
      </div>
    </div>
  )
}

const AgentSessionMessagesWithAgentRightPaneAction = (props: ComponentProps<typeof AgentSessionMessages>) => {
  const { openAgentToolFlow, openArtifactFile } = useAgentRightPaneActions()
  return <AgentSessionMessages {...props} openAgentToolFlow={openAgentToolFlow} openArtifactFile={openArtifactFile} />
}
