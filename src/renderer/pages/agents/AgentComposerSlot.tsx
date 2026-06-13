import type { ComposerContextValue } from '@renderer/components/chat/composer/ComposerContext'
import ConversationComposerSlot from '@renderer/components/chat/composer/ConversationComposerSlot'
import type { ConversationComposerPlacement } from '@renderer/components/chat/composer/ConversationComposerStage'
import AgentComposer from '@renderer/components/chat/composer/variants/AgentComposer'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { ReactNode } from 'react'

import type { AgentChatRuntimeState } from './useAgentChatRuntimeState'

interface AgentComposerSlotProps {
  placement: ConversationComposerPlacement
  homeComposer?: ReactNode
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
  placement,
  homeComposer,
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
    placement === 'home' ? (
      homeComposer
    ) : agentId && !isMultiSelectMode ? (
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
  const effectiveComposerContext = placement === 'home' ? undefined : composerContext

  return <ConversationComposerSlot composerContext={effectiveComposerContext} fallback={fallback} />
}
