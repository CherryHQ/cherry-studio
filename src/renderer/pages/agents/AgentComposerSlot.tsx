import { memo, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useRightPanelPresentationMaximized } from '@renderer/components/chat/panes/Shell'
import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import ConversationComposerSlot from '@renderer/components/composer/ConversationComposerSlot'
import AgentComposer, {
  type AgentComposerLaunchOptions,
  MissingAgentHomeComposer
} from '@renderer/components/composer/variants/AgentComposer'
import { ipcApi } from '@renderer/ipc'
import type { GetAgentResponse } from '@renderer/types/agent'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { Model } from '@shared/data/types/model'

import { ClaudeCodeDownloadStatus } from './ClaudeCodeDownloadStatus'
import type { AgentChatRuntimeState } from './useAgentChatRuntimeState'
import { useClaudeCodeBinary } from './useClaudeCodeBinary'

const logger = loggerService.withContext('AgentComposerSlot')

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
  editing?: AgentChatRuntimeState['editing']
  editBusy?: boolean
  cancelEditing: () => void
  resendEditedMessage: AgentChatRuntimeState['sendMessage']
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
  composerLaunchOptions,
  editing,
  editBusy,
  cancelEditing,
  resendEditedMessage
}: AgentComposerSlotProps) {
  const binary = useClaudeCodeBinary(activeAgent?.type === 'claude-code')
  useEffect(() => {
    if (activeAgent?.type !== 'claude-code' || binary.status?.phase !== 'ready') return
    void ipcApi.request('ai.agent.session.prewarm', { sessionId }).catch((error) => {
      logger.warn('Failed to warm installed Claude runtime', { error })
    })
  }, [activeAgent?.type, binary.status?.phase, sessionId])
  const compactWhenSingleLine = useRightPanelPresentationMaximized()
  const { t } = useTranslation()
  const editLaunchOptions = useMemo<AgentComposerLaunchOptions | undefined>(
    () =>
      editing
        ? {
            initialDraft: { text: '', tokens: [] },
            initialParts: editing.parts,
            editing: {
              messageId: editing.messageId,
              onCancel: cancelEditing,
              description: t('agent.edit_resend.warning'),
              sendLabel: t('agent.edit_resend.save')
            }
          }
        : undefined,
    [cancelEditing, editing, t]
  )
  const renderComposer = (isEditing = false) =>
    agentId ? (
      <AgentComposer
        agentId={agentId}
        sessionId={sessionId}
        sessionOverride={session}
        resolvedAgent={activeAgent}
        resolvedModel={activeModel}
        resolvedWorkspaceWarning={workspaceWarning ?? null}
        externalContextControls
        canChangeModel={!isEditing}
        sendMessage={isEditing ? resendEditedMessage : sendMessage}
        stop={stop}
        isStreaming={!isEditing && isStreaming}
        sendDisabled={binary.blocked || sendDisabled || (isEditing && (isStreaming || editBusy))}
        onCreateEmptySession={isEditing ? undefined : onCreateEmptySession}
        compactWhenSingleLine={compactWhenSingleLine}
        launchOptions={isEditing ? editLaunchOptions : composerLaunchOptions}
      />
    ) : (
      <MissingAgentHomeComposer onAgentChange={onAgentChange} agentChanging={agentChanging} />
    )
  const context: ComposerContextValue = {
    ...composerContext,
    overrides: [
      ...(composerContext.overrides ?? []),
      ...(editing && agentId
        ? [{ id: `edit:${editing.messageId}`, priority: 10, render: () => renderComposer(true) }]
        : [])
    ]
  }

  return (
    <>
      {!isMultiSelectMode && binary.blocked && (
        <ClaudeCodeDownloadStatus status={binary.status} onRetry={binary.retry} />
      )}
      <ConversationComposerSlot composerContext={context} fallback={!isMultiSelectMode && renderComposer()} />
    </>
  )
}

export default memo(AgentComposerSlot)
