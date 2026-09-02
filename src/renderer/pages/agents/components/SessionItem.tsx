import { Tooltip } from '@cherrystudio/ui'
import { ActionConfirmDialog } from '@renderer/components/chat/actions/ActionConfirmDialog'
import { ResourceListActionContextMenu } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
import type {
  SessionActionContext,
  SessionExportMenuOptions
} from '@renderer/components/chat/actions/sessionItemActions'
import { useOptionalRightPanelActions, useOptionalRightPanelState } from '@renderer/components/chat/panes/Shell'
import {
  CONVERSATION_ROW_STATUS_TITLE_CLASS,
  ConversationRowStatus,
  ResourceList,
  useResourceListActions,
  useResourceListRowState
} from '@renderer/components/chat/resourceList/base'
import { useCache } from '@renderer/data/hooks/useCache'
import { useSessionMenuActions } from '@renderer/hooks/chat/useSessionMenuActions'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { buildAgentSessionTopicId, getChannelTypeIcon } from '@renderer/utils/agentSession'
import { cn } from '@renderer/utils/style'
import { classifyTurn } from '@shared/ai/transport'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import { PinIcon, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SessionItemProps {
  active?: boolean
  channelType?: string
  onDelete: (id: string) => void | Promise<void>
  onOpenInNewTab?: (session: AgentSessionEntity) => void
  onOpenInNewWindow?: (session: AgentSessionEntity) => void
  onOpenRenameDialog: (session: AgentSessionEntity) => void
  onPress: (id: string) => void
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onTogglePin?: (id: string) => void | Promise<unknown>
  panePosition?: TopicTabPosition
  pinned?: boolean
  reserveLeadingIconSlot?: boolean
  session: AgentSessionEntity
  sessionMenuActions: SessionItemMenuActions
}

export interface SessionItemMenuActions {
  exportMenuOptions: SessionExportMenuOptions
  onAutoRename: (session: AgentSessionEntity) => void | Promise<void>
  onCopyImage: (session: AgentSessionEntity) => void | Promise<void>
  onCopyMarkdown: (session: AgentSessionEntity) => void | Promise<void>
  onCopyPlainText: (session: AgentSessionEntity) => void | Promise<void>
  onExportImage: (session: AgentSessionEntity) => void | Promise<void>
  onExportJoplin: (session: AgentSessionEntity) => void | Promise<void>
  onExportMarkdown: (session: AgentSessionEntity) => void | Promise<void>
  onExportMarkdownReason: (session: AgentSessionEntity) => void | Promise<void>
  onExportNotion: (session: AgentSessionEntity) => void | Promise<void>
  onExportObsidian: (session: AgentSessionEntity) => void | Promise<void>
  onExportSiyuan: (session: AgentSessionEntity) => void | Promise<void>
  onExportWord: (session: AgentSessionEntity) => void | Promise<void>
  onExportYuque: (session: AgentSessionEntity) => void | Promise<void>
  onSaveToKnowledge: (session: AgentSessionEntity) => void | Promise<void>
  onSaveToNotes: (session: AgentSessionEntity) => void | Promise<void>
}

const SessionItem = ({
  active = false,
  channelType,
  onDelete,
  onOpenInNewTab,
  onOpenInNewWindow,
  onOpenRenameDialog,
  onPress,
  onSetPanePosition,
  panePosition,
  onTogglePin,
  pinned = false,
  reserveLeadingIconSlot = true,
  session,
  sessionMenuActions
}: SessionItemProps) => {
  const { t } = useTranslation()
  const rightPanelState = useOptionalRightPanelState()
  const rightPanelActions = useOptionalRightPanelActions()
  const actions = useResourceListActions()
  const rowState = useResourceListRowState(session.id)
  const topicId = useMemo(() => buildAgentSessionTopicId(session.id), [session.id])
  const [renamingTopics] = useCache('topic.renaming')
  const [newlyRenamedTopics] = useCache('topic.newly_renamed')
  const {
    status,
    awaitingApprovalAnchors,
    isFulfilled: isStreamFulfilled,
    isPending: isStreamPending,
    markSeen
  } = useTopicStreamStatus(topicId)
  const channelIcon = getChannelTypeIcon(channelType)
  const isActive = rowState.selected
  const sessionName = !session.isNameManuallyEdited && !session.name.trim() ? t('agent.session.new') : session.name
  const isRenaming = renamingTopics?.includes(topicId) === true
  const isNewlyRenamed = newlyRenamedTopics?.includes(topicId) === true
  const nameAnimationClassName = isRenaming ? 'animation-shimmer' : isNewlyRenamed ? 'animation-reveal' : ''
  // A live stream can pause for tool approval without a status transition
  // (anchors set mid-stream), while the MCP needsApproval path ends the stream
  // with the terminal 'awaiting-approval' status — the badge must cover both.
  // Unlike the completion dot, awaiting-approval is an ongoing state, so it
  // stays on the selected row too (it only yields to hover actions).
  const showAwaitingApprovalBadge = awaitingApprovalAnchors.length > 0 || classifyTurn(status).isAwaitingApproval
  const isStreamErrored = status === 'error'
  // The status overlay (spinner / red / green dot) sits at ONE fixed spot
  // (right-1.5) on every row so the indicators line up. Running (spinner) and
  // errored (red) are ongoing states that stay on the selected row too — only
  // the completion dot (green) is a read-receipt that clears once the row is
  // opened (`!isActive`). It yields to hover actions. While awaiting approval
  // the pill alone is shown — no spinner: a paused turn is blocked, not
  // running, so a spinner would send the opposite signal ("wait" vs "act").
  const conversationRowStatus = showAwaitingApprovalBadge
    ? 'approval'
    : isStreamPending
      ? 'pending'
      : isStreamErrored
        ? 'error'
        : !isActive && isStreamFulfilled
          ? 'done'
          : null
  const hasStreamIndicator = conversationRowStatus !== null && conversationRowStatus !== 'approval'
  const showPinAction = !rowState.renaming && !!onTogglePin
  const showLeadingSlot = reserveLeadingIconSlot || !!channelIcon
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const startInlineEdit = useCallback(() => actions.startRename(session.id), [actions, session.id])
  const startMenuEdit = useCallback(() => onOpenRenameDialog(session), [onOpenRenameDialog, session])
  const handleDelete = useCallback(() => onDelete(session.id), [onDelete, session.id])
  const handleTogglePin = useCallback(() => {
    void onTogglePin?.(session.id)
  }, [onTogglePin, session.id])
  const handleOpenInNewTab = useCallback(() => {
    onOpenInNewTab?.(session)
  }, [onOpenInNewTab, session])
  const handleOpenInNewWindow = useCallback(() => {
    onOpenInNewWindow?.(session)
  }, [onOpenInNewWindow, session])

  const actionContext = useMemo<SessionActionContext>(
    () => ({
      exportMenuOptions: sessionMenuActions.exportMenuOptions,
      isActiveInCurrentTab: active,
      isRenaming,
      onAutoRename: () => sessionMenuActions.onAutoRename(session),
      onCopyImage: () => sessionMenuActions.onCopyImage(session),
      onCopyMarkdown: () => sessionMenuActions.onCopyMarkdown(session),
      onCopyPlainText: () => sessionMenuActions.onCopyPlainText(session),
      onDelete: handleDelete,
      onExportImage: () => sessionMenuActions.onExportImage(session),
      onExportJoplin: () => sessionMenuActions.onExportJoplin(session),
      onExportMarkdown: () => sessionMenuActions.onExportMarkdown(session),
      onExportMarkdownReason: () => sessionMenuActions.onExportMarkdownReason(session),
      onExportNotion: () => sessionMenuActions.onExportNotion(session),
      onExportObsidian: () => sessionMenuActions.onExportObsidian(session),
      onExportSiyuan: () => sessionMenuActions.onExportSiyuan(session),
      onExportWord: () => sessionMenuActions.onExportWord(session),
      onExportYuque: () => sessionMenuActions.onExportYuque(session),
      onOpenInNewTab: onOpenInNewTab ? handleOpenInNewTab : undefined,
      onOpenInNewWindow: onOpenInNewWindow ? handleOpenInNewWindow : undefined,
      onSaveToKnowledge: () => sessionMenuActions.onSaveToKnowledge(session),
      onSaveToNotes: () => sessionMenuActions.onSaveToNotes(session),
      onSetPanePosition,
      onTogglePin: onTogglePin ? handleTogglePin : undefined,
      panePosition,
      pinned,
      sessionName,
      startEdit: startMenuEdit,
      t
    }),
    [
      handleDelete,
      handleOpenInNewTab,
      handleOpenInNewWindow,
      handleTogglePin,
      active,
      isRenaming,
      onOpenInNewTab,
      onOpenInNewWindow,
      onSetPanePosition,
      onTogglePin,
      panePosition,
      pinned,
      session,
      sessionMenuActions,
      sessionName,
      startMenuEdit,
      t
    ]
  )

  const { getActions: getMenuActions, handleMenuAction } = useSessionMenuActions(actionContext)
  const deleteAction = useMemo(
    () => getMenuActions().find((action) => action.id === 'session.delete'),
    [getMenuActions]
  )

  const handlePress = useCallback(
    (event: MouseEvent) => {
      // ⌘/Ctrl-click opens the session in a new tab (browser-style), matching the hover action.
      if ((event.metaKey || event.ctrlKey) && onOpenInNewTab && !active) {
        handleOpenInNewTab()
        return
      }
      if (rightPanelState?.maximized) rightPanelActions?.minimize()
      onPress(session.id)
    },
    [active, handleOpenInNewTab, onOpenInNewTab, onPress, rightPanelActions, rightPanelState?.maximized, session.id]
  )

  const handleAuxClick = useCallback(
    (event: MouseEvent) => {
      // Middle-click opens in a new tab.
      if (event.button !== 1 || !onOpenInNewTab || active) return
      event.preventDefault()
      handleOpenInNewTab()
    },
    [active, handleOpenInNewTab, onOpenInNewTab]
  )

  const handleTogglePinClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation()
      handleTogglePin()
    },
    [handleTogglePin]
  )

  useEffect(() => {
    if (!isActive || !isStreamFulfilled) return
    markSeen()
  }, [isActive, isStreamFulfilled, markSeen])

  const row = (
    <ResourceList.Item
      item={session}
      data-testid="agent-session-row"
      className="relative"
      style={{ cursor: 'pointer' }}
      onClick={handlePress}
      onAuxClick={handleAuxClick}
      title={sessionName}>
      {showLeadingSlot && (
        <ResourceList.ItemLeadingSlot className={cn('relative', !rowState.renaming && channelIcon && 'rounded-sm')}>
          {!rowState.renaming && channelIcon ? (
            <img
              src={channelIcon}
              alt=""
              className="pointer-events-none absolute inset-0 m-auto size-3.5 rounded-[2px] object-contain transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0"
            />
          ) : null}
        </ResourceList.ItemLeadingSlot>
      )}

      <ResourceList.RenameField
        item={session}
        aria-label={t('agent.session.edit.title')}
        autoFocus
        onClick={(event) => event.stopPropagation()}
      />

      {!rowState.renaming && (
        <ResourceList.ItemTitle
          fade
          title={sessionName}
          className={cn(
            nameAnimationClassName,
            // The stream indicator is an absolute overlay (keeps no flex space),
            // so the title needs a standing yield for its dot zone; on hover the
            // overlay fades out, the standing yield closes, and the in-flow action rail expands. The
            // awaiting-approval pill (mutually exclusive with the overlay) is an
            // in-flow sibling the title simply fades against — no standing margin.
            hasStreamIndicator && CONVERSATION_ROW_STATUS_TITLE_CLASS
          )}
          onDoubleClick={(event) => {
            event.stopPropagation()
            startInlineEdit()
          }}>
          {sessionName}
        </ResourceList.ItemTitle>
      )}

      {!rowState.renaming && (
        <ConversationRowStatus
          status={conversationRowStatus}
          testId={
            conversationRowStatus === 'approval'
              ? 'agent-session-awaiting-approval-badge'
              : 'agent-session-stream-indicator'
          }
        />
      )}

      <ResourceList.ItemActions active={deleteDialogOpen}>
        {showPinAction && (
          <Tooltip title={pinned ? t('agent.session.unpin.title') : t('agent.session.pin.title')} delay={500}>
            <ResourceList.ItemAction
              aria-label={pinned ? t('agent.session.unpin.title') : t('agent.session.pin.title')}
              className={cn(pinned && 'text-foreground')}
              onClick={handleTogglePinClick}>
              <PinIcon size={14} className={cn('size-3.5!', pinned && 'fill-current')} />
            </ResourceList.ItemAction>
          </Tooltip>
        )}
        {!pinned && (
          <Tooltip title={t('common.delete')} delay={500}>
            <ResourceList.ItemAction
              aria-label={t('common.delete')}
              onClick={(event) => {
                event.stopPropagation()
                setDeleteDialogOpen(true)
              }}>
              <Trash2 size={14} className="size-3.5!" />
            </ResourceList.ItemAction>
          </Tooltip>
        )}
      </ResourceList.ItemActions>
    </ResourceList.Item>
  )

  return (
    <>
      <ResourceListActionContextMenu item={session} getActions={getMenuActions} onAction={handleMenuAction}>
        {row}
      </ResourceListActionContextMenu>
      <ActionConfirmDialog
        open={deleteDialogOpen}
        confirm={deleteAction?.confirm}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={async () => {
          if (!deleteAction) return
          await handleMenuAction(deleteAction)
          setDeleteDialogOpen(false)
        }}
      />
    </>
  )
}

export default memo(SessionItem)
