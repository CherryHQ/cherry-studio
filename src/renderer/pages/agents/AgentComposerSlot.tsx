import { useRightPanelPresentationMaximized } from '@renderer/components/chat/panes/Shell'
import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import ConversationComposerSlot from '@renderer/components/composer/ConversationComposerSlot'
import AgentComposer, {
  type AgentComposerLaunchOptions,
  MissingAgentHomeComposer
} from '@renderer/components/composer/variants/AgentComposer'
import type { GetAgentResponse } from '@renderer/types/agent'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { Model } from '@shared/data/types/model'
import { memo } from 'react'

import type { AgentChatRuntimeState } from './useAgentChatRuntimeState'

interface AgentComposerSlotProps {
  agentId?: string
  activeAgent?: GetAgentResponse
  activeModel?: Model
  workspaceWarning?: string
  isMultiSelectMode: boolean
  session: AgentSessionEntity
  sessionId: string
  sendMessage: AgentChatRuntimeState['sendMessage']
  stop: AgentChatRuntimeState['stop']
  isStreaming: boolean
  sendDisabled: boolean
  onAgentChange?: (agentId: string | null) => void | Promise<void>
  agentChanging?: boolean
  onCreateEmptySession?: () => void | Promise<unknown>
  composerContext: ComposerContextValue
  composerLaunchOptions?: AgentComposerLaunchOptions
}

function AgentComposerSlot({
  agentId,
  activeAgent,
  activeModel,
  workspaceWarning,
  isMultiSelectMode,
  session,
  sessionId,
  sendMessage,
  stop,
  isStreaming,
  sendDisabled,
  onAgentChange,
  agentChanging,
  onCreateEmptySession,
  composerContext,
  composerLaunchOptions
}: AgentComposerSlotProps) {
  const compactWhenSingleLine = useRightPanelPresentationMaximized()
  const fallback = !isMultiSelectMode ? (
    agentId ? (
      <AgentComposer
        agentId={agentId}
        sessionId={sessionId}
        sessionOverride={session}
        resolvedAgent={activeAgent}
        resolvedModel={activeModel}
        resolvedWorkspaceWarning={workspaceWarning ?? null}
        externalContextControls
        sendMessage={sendMessage}
        stop={stop}
        isStreaming={isStreaming}
        sendDisabled={sendDisabled}
        onCreateEmptySession={onCreateEmptySession}
        compactWhenSingleLine={compactWhenSingleLine}
        launchOptions={composerLaunchOptions}
      />
    ) : (
      <MissingAgentHomeComposer onAgentChange={onAgentChange} agentChanging={agentChanging} />
    )
  ) : undefined

  return <ConversationComposerSlot composerContext={composerContext} fallback={fallback} />
}

export default memo(AgentComposerSlot)
