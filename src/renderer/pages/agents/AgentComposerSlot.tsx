import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useRightPanelPresentationMaximized } from '@renderer/components/chat/panes/Shell'
import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import ConversationComposerSlot from '@renderer/components/composer/ConversationComposerSlot'
import AgentComposer, {
  type AgentComposerLaunchOptions,
  MissingAgentHomeComposer
} from '@renderer/components/composer/variants/AgentComposer'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { GetAgentResponse } from '@renderer/types/agent'
import type { AgentSessionFollowup } from '@shared/ai/agentSessionFollowups'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'

import { ClaudeCodeDownloadStatus } from './ClaudeCodeDownloadStatus'
import { useOptionalAgentRightPaneActions } from './components/AgentRightPane'
import type { AgentChatRuntimeState } from './useAgentChatRuntimeState'
import { useClaudeCodeBinary } from './useClaudeCodeBinary'

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
  messages?: readonly CherryUIMessage[]
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
  steerWhileBusy?: boolean
  providerQuotaExhausted?: boolean
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
  messages,
  sendDisabled,
  onAgentChange,
  agentChanging,
  onCreateEmptySession,
  composerContext,
  composerLaunchOptions,
  editing,
  editBusy,
  cancelEditing,
  resendEditedMessage,
  steerWhileBusy,
  providerQuotaExhausted
}: AgentComposerSlotProps) {
  const binary = useClaudeCodeBinary(activeAgent?.type === 'claude-code')
  const compactWhenSingleLine = useRightPanelPresentationMaximized()
  const rightPaneActions = useOptionalAgentRightPaneActions()
  const { t } = useTranslation()
  const [queuedEdit, setQueuedEdit] = useState<{ sessionId: string; topicId: string; item: AgentSessionFollowup }>()
  const activeQueuedEdit = queuedEdit?.sessionId === sessionId ? queuedEdit : undefined
  const startQueuedEdit = useCallback(
    (topicId: string, item: AgentSessionFollowup) => setQueuedEdit({ sessionId, topicId, item }),
    [sessionId]
  )
  const cancelQueuedEdit = useCallback(() => setQueuedEdit(undefined), [])
  const saveQueuedEdit = useCallback<AgentChatRuntimeState['sendMessage']>(
    async (_, options) => {
      const parts = options?.body?.userMessageParts
      if (!activeQueuedEdit || !parts) return false
      const { topicId, item } = activeQueuedEdit
      const saved = await ipcApi.request('ai.agent.session.change_followups', {
        topicId,
        change: { type: 'edit', inputId: item.id, revision: item.revision, parts }
      })
      if (saved) setQueuedEdit((current) => (current === activeQueuedEdit ? undefined : current))
      else toast.warning(t('chat.input.followup_queue.stale'))
      return saved
    },
    [activeQueuedEdit, t]
  )
  const editTarget = useMemo(
    () =>
      editing ??
      (activeQueuedEdit && {
        messageId: activeQueuedEdit.item.id,
        parts: activeQueuedEdit.item.parts
      }),
    [activeQueuedEdit, editing]
  )
  const isQueuedEdit = !editing && !!activeQueuedEdit
  const onCancelEdit = isQueuedEdit ? cancelQueuedEdit : cancelEditing
  const editLaunchOptions = useMemo<AgentComposerLaunchOptions | undefined>(
    () =>
      editTarget
        ? {
            initialDraft: { text: '', tokens: [] },
            initialParts: editTarget.parts,
            editing: {
              messageId: editTarget.messageId,
              onCancel: onCancelEdit,
              sendLabel: t(isQueuedEdit ? 'common.save' : 'agent.edit_resend.save')
            }
          }
        : undefined,
    [editTarget, isQueuedEdit, onCancelEdit, t]
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
        sendMessage={isEditing ? (isQueuedEdit ? saveQueuedEdit : resendEditedMessage) : sendMessage}
        stop={stop}
        isStreaming={!isEditing && isStreaming}
        messages={isEditing ? undefined : messages}
        sendDisabled={binary.blocked || sendDisabled || (isEditing && !isQueuedEdit && (isStreaming || editBusy))}
        onCreateEmptySession={isEditing ? undefined : onCreateEmptySession}
        compactWhenSingleLine={compactWhenSingleLine}
        previewInputFile={
          rightPaneActions?.canPreviewInputFileInRightPane ? rightPaneActions.previewInputFileInRightPane : undefined
        }
        launchOptions={isEditing ? editLaunchOptions : composerLaunchOptions}
        onEditQueuedFollowup={isEditing ? undefined : startQueuedEdit}
        steerWhileBusy={steerWhileBusy}
        providerQuotaExhausted={!isEditing && providerQuotaExhausted}
      />
    ) : (
      <MissingAgentHomeComposer onAgentChange={onAgentChange} agentChanging={agentChanging} />
    )
  const context: ComposerContextValue = {
    ...composerContext,
    overrides: [
      ...(composerContext.overrides ?? []),
      ...(editTarget && agentId
        ? [{ id: `edit:${editTarget.messageId}`, priority: 10, render: () => renderComposer(true) }]
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
