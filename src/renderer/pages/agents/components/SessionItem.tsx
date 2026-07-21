import { Tooltip } from '@cherrystudio/ui'
import { ResourceListActionContextMenu } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
import type {
  SessionActionContext,
  SessionExportMenuOptions
} from '@renderer/components/chat/actions/sessionItemActions'
import { useOptionalRightPanelActions, useOptionalRightPanelState } from '@renderer/components/chat/panes/Shell'
import {
  ResourceList,
  useResourceListActions,
  useResourceListRowState
} from '@renderer/components/chat/resourceList/base'
import EditNameDialog from '@renderer/components/EditNameDialog'
import { useCache } from '@renderer/data/hooks/useCache'
import { useSessionMenuActions } from '@renderer/hooks/chat/useSessionMenuActions'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { buildAgentSessionTopicId, getChannelTypeIcon } from '@renderer/utils/agentSession'
import { cn } from '@renderer/utils/style'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import { PinIcon, Trash2, XIcon } from 'lucide-react'
import type { MouseEvent } from 'react'
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const DELETE_CONFIRMATION_TIMEOUT = 2000

interface SessionItemProps {
  active?: boolean
  channelType?: string
  onDelete: (id: string) => void | Promise<void>
  onOpenInNewTab?: (session: AgentSessionEntity) => void
  onOpenInNewWindow?: (session: AgentSessionEntity) => void
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
  const { isFulfilled: isStreamFulfilled, isPending: isStreamPending, markSeen } = useTopicStreamStatus(topicId)
  const channelIcon = getChannelTypeIcon(channelType)
  const isActive = rowState.selected
  const sessionName = !session.isNameManuallyEdited && !session.name.trim() ? t('agent.session.new') : session.name
  const isRenaming = renamingTopics?.includes(topicId) === true
  const isNewlyRenamed = newlyRenamedTopics?.includes(topicId) === true
  const nameAnimationClassName = isRenaming ? 'animation-shimmer' : isNewlyRenamed ? 'animation-reveal' : ''
  const hasStreamIndicator = !isActive && (isStreamPending || isStreamFulfilled)
  const showPinAction = !rowState.renaming && !!onTogglePin
  const showLeadingSlot = reserveLeadingIconSlot || !!channelIcon
  const showDeleteOrStreamAction = hasStreamIndicator || !pinned
  // Reserve right-padding so the title truncates before hover actions and stream state.
  const trailingActionCount = (showPinAction ? 1 : 0) + (showDeleteOrStreamAction ? 1 : 0)
  const sessionTrailingActionPaddingClassName =
    trailingActionCount >= 3
      ? 'group-focus-within:pr-16 group-hover:pr-16 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-16'
      : trailingActionCount === 2
        ? 'group-focus-within:pr-12 group-hover:pr-12 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-12'
        : trailingActionCount === 1
          ? 'group-focus-within:pr-7 group-hover:pr-7 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-7'
          : ''
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [isConfirmingDeletion, setIsConfirmingDeletion] = useState(false)
  const deleteConfirmationTimeoutRef = useRef<number | null>(null)

  const startInlineEdit = useCallback(() => actions.startRename(session.id), [actions, session.id])
  const startMenuEdit = useCallback(() => setRenameDialogOpen(true), [])
  const submitRenameDialog = useCallback(
    (name: string) => actions.commitRename(session.id, name),
    [actions, session.id]
  )
  const handleDelete = useCallback(() => {
    void onDelete(session.id)
  }, [onDelete, session.id])
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

  const clearDeleteConfirmationTimeout = useCallback(() => {
    if (deleteConfirmationTimeoutRef.current === null) return
    window.clearTimeout(deleteConfirmationTimeoutRef.current)
    deleteConfirmationTimeoutRef.current = null
  }, [])

  useEffect(() => clearDeleteConfirmationTimeout, [clearDeleteConfirmationTimeout])

  const handleDeleteClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation()

      if (isConfirmingDeletion || event.ctrlKey || event.metaKey) {
        clearDeleteConfirmationTimeout()
        setIsConfirmingDeletion(false)
        handleDelete()
        return
      }

      startTransition(() => {
        clearDeleteConfirmationTimeout()
        setIsConfirmingDeletion(true)
        deleteConfirmationTimeoutRef.current = window.setTimeout(() => {
          deleteConfirmationTimeoutRef.current = null
          setIsConfirmingDeletion(false)
        }, DELETE_CONFIRMATION_TIMEOUT)
      })
    },
    [clearDeleteConfirmationTimeout, handleDelete, isConfirmingDeletion]
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
          title={sessionName}
          className={cn(nameAnimationClassName, 'transition-[padding]', sessionTrailingActionPaddingClassName)}
          onDoubleClick={(event) => {
            event.stopPropagation()
            startInlineEdit()
          }}>
          {sessionName}
        </ResourceList.ItemTitle>
      )}

      <ResourceList.ItemActions active={hasStreamIndicator || isConfirmingDeletion}>
        {showPinAction && (
          <Tooltip title={pinned ? t('agent.session.unpin.title') : t('agent.session.pin.title')} delay={500}>
            <ResourceList.ItemAction
              aria-label={pinned ? t('agent.session.unpin.title') : t('agent.session.pin.title')}
              className={cn(pinned && 'text-foreground/70 hover:text-foreground')}
              onClick={handleTogglePinClick}>
              <PinIcon size={13} className={cn('size-3.25!', pinned && '-rotate-45')} />
            </ResourceList.ItemAction>
          </Tooltip>
        )}
        {hasStreamIndicator ? (
          <SessionStreamIndicator isFulfilled={isStreamFulfilled} isPending={isStreamPending} />
        ) : !pinned ? (
          <Tooltip title={t('common.delete')} delay={500}>
            <ResourceList.ItemAction
              aria-label={t('common.delete')}
              data-deleting={isConfirmingDeletion}
              onClick={handleDeleteClick}>
              {isConfirmingDeletion ? (
                <Trash2 size={14} className="size-3.5! text-destructive" />
              ) : (
                <XIcon size={14} className="size-3.5!" />
              )}
            </ResourceList.ItemAction>
          </Tooltip>
        ) : null}
      </ResourceList.ItemActions>
    </ResourceList.Item>
  )

  return (
    <>
      <ResourceListActionContextMenu item={session} getActions={getMenuActions} onAction={handleMenuAction}>
        {row}
      </ResourceListActionContextMenu>
      <EditNameDialog
        open={renameDialogOpen}
        title={t('agent.session.edit.title')}
        initialName={session.name ?? ''}
        onSubmit={submitRenameDialog}
        onOpenChange={setRenameDialogOpen}
      />
    </>
  )
}

const SessionStreamIndicator = ({ isFulfilled, isPending }: { isFulfilled: boolean; isPending: boolean }) => {
  const dotClassName = cn('size-1.25 rounded-full', isPending ? 'animation-pulse bg-warning' : 'bg-success')

  if (!isPending && !isFulfilled) return null

  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center opacity-100 group-hover:opacity-100"
      data-testid="agent-session-stream-indicator">
      <span className={dotClassName} />
    </span>
  )
}

export default memo(SessionItem)
