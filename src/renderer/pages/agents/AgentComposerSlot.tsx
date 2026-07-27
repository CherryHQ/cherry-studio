import { useOptionalRightPanelState } from '@renderer/components/chat/panes/Shell'
import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import ConversationComposerLoading from '@renderer/components/composer/ConversationComposerLoading'
import ConversationComposerSlot from '@renderer/components/composer/ConversationComposerSlot'
import type { GetAgentResponse } from '@renderer/types/agent'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { Model } from '@shared/data/types/model'
import { lazy, memo } from 'react'

import type { AgentChatRuntimeState } from './useAgentChatRuntimeState'

const AgentComposer = lazy(() => import('@renderer/components/composer/variants/AgentComposer'))

interface AgentComposerSlotProps {
  agentId?: string
  agentLoading: boolean
  activeAgent?: GetAgentResponse
  activeModel?: Model
  workspaceWarning?: string
  isMultiSelectMode: boolean
  session: AgentSessionEntity
  sessionId: string
  sendMessage: AgentChatRuntimeState['sendMessage']
  captureLocalSendScrollEligibility: AgentChatRuntimeState['captureLocalSendScrollEligibility']
  stop: AgentChatRuntimeState['stop']
  isStreaming: boolean
  sendDisabled: boolean
  onCreateEmptySession?: () => void | Promise<unknown>
  composerContext: ComposerContextValue
}

function AgentComposerSlot({
  agentId,
  agentLoading,
  activeAgent,
  activeModel,
  workspaceWarning,
  isMultiSelectMode,
  session,
  sessionId,
  sendMessage,
  captureLocalSendScrollEligibility,
  stop,
  isStreaming,
  sendDisabled,
  onCreateEmptySession,
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
        resolvedAgent={activeAgent}
        resolvedModel={activeModel}
        resolvedWorkspaceWarning={workspaceWarning ?? null}
        externalContextControls
        sendMessage={sendMessage}
        captureLocalSendScrollEligibility={captureLocalSendScrollEligibility}
        stop={stop}
        isStreaming={isStreaming}
        sendDisabled={sendDisabled}
        onCreateEmptySession={onCreateEmptySession}
        compactWhenSingleLine={compactWhenSingleLine}
      />
    ) : agentLoading && !isMultiSelectMode ? (
      <ConversationComposerLoading compact={compactWhenSingleLine} />
    ) : undefined

  return <ConversationComposerSlot scopeKey={sessionId} composerContext={composerContext} fallback={fallback} />
}

export default memo(AgentComposerSlot)
