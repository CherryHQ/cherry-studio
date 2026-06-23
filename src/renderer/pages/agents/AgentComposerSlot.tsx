import type { ComposerContextValue } from '@renderer/components/chat/composer/ComposerContext'
import ConversationComposerSlot from '@renderer/components/chat/composer/ConversationComposerSlot'
import AgentComposer from '@renderer/components/chat/composer/variants/AgentComposer'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import type { AgentChatRuntimeState } from './useAgentChatRuntimeState'

interface AgentComposerSlotProps {
  agentId?: string
  isMultiSelectMode: boolean
  session: AgentSessionEntity
  sessionId: string
  sendMessage: AgentChatRuntimeState['sendMessage']
  stop: AgentChatRuntimeState['stop']
  isStreaming: boolean
  sendDisabled: boolean
  onNewSessionDraft?: () => void | Promise<void>
  composerContext: ComposerContextValue
}

export default function AgentComposerSlot({
  agentId,
  isMultiSelectMode,
  session,
  sessionId,
  sendMessage,
  stop,
  isStreaming,
  sendDisabled,
  onNewSessionDraft,
  composerContext
}: AgentComposerSlotProps) {
  const fallback =
    agentId && !isMultiSelectMode ? (
      <AgentComposer
        agentId={agentId}
        sessionId={sessionId}
        sessionOverride={session}
        sendMessage={sendMessage}
        stop={stop}
        isStreaming={isStreaming}
        sendDisabled={sendDisabled}
        onNewSessionDraft={onNewSessionDraft}
      />
    ) : undefined

  return <ConversationComposerSlot composerContext={composerContext} fallback={fallback} />
}
