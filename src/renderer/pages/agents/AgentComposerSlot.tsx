import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import ConversationComposerSlot from '@renderer/components/composer/ConversationComposerSlot'
import AgentComposer from '@renderer/components/composer/variants/AgentComposer'
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
  onCreateEmptySession?: () => void | Promise<void>
  workspaceId?: string | null
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  workspaceChanging?: boolean
  showWorkspaceSelector?: boolean
  canChangeModel?: boolean
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
  onCreateEmptySession,
  workspaceId,
  onWorkspaceChange,
  workspaceChanging,
  showWorkspaceSelector,
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
        onNewSessionDraft={onNewSessionDraft}
        onCreateEmptySession={onCreateEmptySession}
        workspaceId={workspaceId}
        onWorkspaceChange={onWorkspaceChange}
        workspaceChanging={workspaceChanging}
        showWorkspaceSelector={showWorkspaceSelector}
        canChangeModel={canChangeModel}
      />
    ) : undefined

  return <ConversationComposerSlot composerContext={composerContext} fallback={fallback} />
}
