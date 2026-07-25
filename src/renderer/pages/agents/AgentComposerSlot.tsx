import { useOptionalRightPanelState } from '@renderer/components/chat/panes/Shell'
import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import ConversationComposerLoading from '@renderer/components/composer/ConversationComposerLoading'
import ConversationComposerSlot from '@renderer/components/composer/ConversationComposerSlot'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { lazy, memo } from 'react'

import type { AgentChatRuntimeState } from './useAgentChatRuntimeState'

const AgentComposer = lazy(() => import('@renderer/components/composer/variants/AgentComposer'))

interface AgentComposerSlotProps {
  agentId?: string
  agentLoading: boolean
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
  agentLoading,
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
  const rightPanelState = useOptionalRightPanelState()
  const compactWhenSingleLine = Boolean(
    rightPanelState?.presentationMaximized && rightPanelState.activePanelId === 'files'
  )
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
        compactWhenSingleLine={compactWhenSingleLine}
      />
    ) : agentLoading && !isMultiSelectMode ? (
      <ConversationComposerLoading />
    ) : undefined

  return <ConversationComposerSlot scopeKey={sessionId} composerContext={composerContext} fallback={fallback} />
}

export default memo(AgentComposerSlot)
