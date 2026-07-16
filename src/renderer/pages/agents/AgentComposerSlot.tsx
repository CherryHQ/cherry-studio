import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import ConversationComposerSlot from '@renderer/components/composer/ConversationComposerSlot'
import AgentComposer from '@renderer/components/composer/variants/AgentComposer'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { memo } from 'react'

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
  onCreateEmptySession?: () => void | Promise<unknown>
  canChangeAgent?: boolean
  workspaceId?: string | null
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  workspaceChanging?: boolean
  canChangeModel?: boolean
  composerContext: ComposerContextValue
}

function AgentComposerSlot({
  agentId,
  isMultiSelectMode,
  session,
  sessionId,
  sendMessage,
  stop,
  isStreaming,
  sendDisabled,
  onCreateEmptySession,
  canChangeAgent,
  workspaceId,
  onWorkspaceChange,
  workspaceChanging,
  canChangeModel,
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
        onCreateEmptySession={onCreateEmptySession}
        canChangeAgent={canChangeAgent}
        workspaceId={workspaceId}
        onWorkspaceChange={onWorkspaceChange}
        workspaceChanging={workspaceChanging}
        canChangeModel={canChangeModel}
      />
    ) : undefined

  return <ConversationComposerSlot composerContext={composerContext} fallback={fallback} />
}

export default memo(AgentComposerSlot)
