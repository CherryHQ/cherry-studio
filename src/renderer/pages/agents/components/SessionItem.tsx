import { Tooltip } from '@cherrystudio/ui'
import { ResourceListActionContextMenu } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
import { ResourceList, useResourceListActions, useResourceListRowState } from '@renderer/components/chat/resources'
import EditNameDialog from '@renderer/components/EditNameDialog'
import { useCache } from '@renderer/data/hooks/useCache'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { buildAgentSessionTopicId, getChannelTypeIcon } from '@renderer/utils/agentSession'
import { cn } from '@renderer/utils/style'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { PinIcon, Trash2, XIcon } from 'lucide-react'
import type { MouseEvent } from 'react'
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SessionActionContext } from './sessionItemActions'
import { useSessionMenuActions } from './useSessionMenuActions'

const DELETE_CONFIRMATION_TIMEOUT = 2000

interface SessionItemProps {
  active?: boolean
  channelType?: string
  onDelete: (id: string) => void | Promise<void>
  onOpenInNewTab?: (session: AgentSessionEntity) => void
  onOpenInNewWindow?: (session: AgentSessionEntity) => void
  onPress: (id: string) => void
  onSelectItem?: () => void
  onTogglePin?: (id: string) => void | Promise<unknown>
  pinned?: boolean
  reserveLeadingIconSlot?: boolean
  session: AgentSessionEntity
}

const SessionItem = ({
  active = false,
  channelType,
  onDelete,
  onOpenInNewTab,
  onOpenInNewWindow,
  onPress,
  onSelectItem,
  onTogglePin,
  pinned = false,
  reserveLeadingIconSlot = true,
  session
}: SessionItemProps) => {
  const { t } = useTranslation()
  const actions = useResourceListActions()
  const rowState = useResourceListRowState(session.id)
  const topicId = useMemo(() => buildAgentSessionTopicId(session.id), [session.id])
  const [renamingTopics] = useCache('topic.renaming')
  const [newlyRenamedTopics] = useCache('topic.newly_renamed')
  const { isFulfilled: isStreamFulfilled, isPending: isStreamPending, markSeen } = useTopicStreamStatus(topicId)
  const channelIcon = getChannelTypeIcon(channelType)
  const isActive = rowState.selected
  const sessionName = session.name ?? session.id
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
      isActiveInCurrentTab: active,
      onDelete: handleDelete,
      onOpenInNewTab: onOpenInNewTab ? handleOpenInNewTab : undefined,
      onOpenInNewWindow: onOpenInNewWindow ? handleOpenInNewWindow : undefined,
      onTogglePin: onTogglePin ? handleTogglePin : undefined,
      pinned,
      sessionName: session.name ?? '',
      startEdit: startMenuEdit,
      t
    }),
    [
      handleDelete,
      handleOpenInNewTab,
      handleOpenInNewWindow,
      handleTogglePin,
      active,
      onOpenInNewTab,
      onOpenInNewWindow,
      onTogglePin,
      pinned,
      session.name,
      startMenuEdit,
      t
    ]
  )

  const { menuActions, handleMenuAction } = useSessionMenuActions(actionContext)

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
      onPress(session.id)
      onSelectItem?.()
    },
    [active, handleOpenInNewTab, onOpenInNewTab, onPress, onSelectItem, session.id]
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
      <ResourceListActionContextMenu item={session} actions={menuActions} onAction={handleMenuAction}>
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
