import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

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
  const context = useMemo<ComposerContextValue>(
    () => ({
      overrides: [
        ...(composerContext.overrides ?? []),
        ...(editing && agentId
          ? [
              {
                id: `edit:${editing.messageId}`,
                priority: 10,
                render: () => (
                  <AgentComposer
                    agentId={agentId}
                    sessionId={sessionId}
                    sessionOverride={session}
                    resolvedAgent={activeAgent}
                    resolvedModel={activeModel}
                    resolvedWorkspaceWarning={workspaceWarning ?? null}
                    externalContextControls
                    canChangeModel={false}
                    sendMessage={resendEditedMessage}
                    stop={stop}
                    isStreaming={false}
                    sendDisabled={sendDisabled || isStreaming || editBusy}
                    launchOptions={editLaunchOptions}
                    compactWhenSingleLine={compactWhenSingleLine}
                  />
                )
              }
            ]
          : [])
      ]
    }),
    [
      composerContext.overrides,
      editing,
      editBusy,
      agentId,
      sessionId,
      session,
      activeAgent,
      activeModel,
      workspaceWarning,
      resendEditedMessage,
      stop,
      sendDisabled,
      isStreaming,
      editLaunchOptions,
      compactWhenSingleLine
    ]
  )
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

  return <ConversationComposerSlot composerContext={context} fallback={fallback} />
}

export default memo(AgentComposerSlot)
