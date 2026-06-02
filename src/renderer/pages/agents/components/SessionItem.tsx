import { Tooltip } from '@cherrystudio/ui'
import { ResourceListActionContextMenu } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
import { ResourceList, useResourceListActions, useResourceListRowState } from '@renderer/components/chat/resources'
import EditNameDialog from '@renderer/components/EditNameDialog'
import { useCache } from '@renderer/data/hooks/useCache'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { buildAgentSessionTopicId, getChannelTypeIcon } from '@renderer/utils/agentSession'
import { cn } from '@renderer/utils/style'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import { PinIcon, SquareArrowOutUpRight } from 'lucide-react'
import type { MouseEvent } from 'react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SessionActionContext } from './sessionItemActions'
import { useSessionMenuActions } from './useSessionMenuActions'

interface SessionItemProps {
  channelType?: string
  onDelete: (id: string) => void | Promise<void>
  onEditAgent: (agentId: string) => void
  onOpenInNewTab?: (session: AgentSessionEntity) => void
  onPress: (id: string) => void
  onSelectItem?: () => void
  onTogglePin?: (id: string) => void | Promise<void>
  pinned?: boolean
  session: AgentSessionEntity
}

const SessionItem = ({
  channelType,
  onDelete,
  onEditAgent,
  onOpenInNewTab,
  onPress,
  onSelectItem,
  onTogglePin,
  pinned = false,
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
  // The active session is already shown in this tab — hide "open in new tab" on it.
  const showOpenInNewTabAction = !!onOpenInNewTab && !isActive
  // Pin moved to the leading slot; the trailing slot now only holds "open in new
  // tab" and the stream indicator. Reserve right-padding (literal Tailwind classes)
  // so the title truncates before those hover actions, sized to the action count.
  const trailingActionCount = (showOpenInNewTabAction ? 1 : 0) + (hasStreamIndicator ? 1 : 0)
  const sessionTrailingActionPaddingClassName =
    trailingActionCount >= 2
      ? 'group-focus-within:pr-12 group-hover:pr-12 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-12'
      : trailingActionCount === 1
        ? 'group-focus-within:pr-7 group-hover:pr-7 group-has-[[data-resource-list-item-actions][data-active=true]]:pr-7'
        : ''
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)

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
  const handleEditAgent = useCallback(() => {
    if (session.agentId) {
      onEditAgent(session.agentId)
    }
  }, [onEditAgent, session.agentId])
  const handleOpenInNewTab = useCallback(() => {
    onOpenInNewTab?.(session)
  }, [onOpenInNewTab, session])

  const actionContext = useMemo<SessionActionContext>(
    () => ({
      onDelete: handleDelete,
      onEditAgent: session.agentId ? handleEditAgent : undefined,
      onOpenInNewTab: onOpenInNewTab ? handleOpenInNewTab : undefined,
      onTogglePin: onTogglePin ? handleTogglePin : undefined,
      pinned,
      sessionName: session.name ?? '',
      startEdit: startMenuEdit,
      t
    }),
    [
      handleDelete,
      handleEditAgent,
      handleOpenInNewTab,
      handleTogglePin,
      onOpenInNewTab,
      onTogglePin,
      pinned,
      session.agentId,
      session.name,
      startMenuEdit,
      t
    ]
  )

  const { menuActions, handleMenuAction } = useSessionMenuActions(actionContext)

  const handlePress = useCallback(
    (event: MouseEvent) => {
      // ⌘/Ctrl-click opens the session in a new tab (browser-style), matching
      // the hover ⤢ action. Skip the active session — it's already shown here.
      if ((event.metaKey || event.ctrlKey) && onOpenInNewTab && !isActive) {
        handleOpenInNewTab()
        return
      }
      onPress(session.id)
      onSelectItem?.()
    },
    [handleOpenInNewTab, onOpenInNewTab, isActive, onPress, onSelectItem, session.id]
  )

  const handleAuxClick = useCallback(
    (event: MouseEvent) => {
      // Middle-click opens in a new tab (except the already-shown active session).
      if (isActive || event.button !== 1 || !onOpenInNewTab) return
      event.preventDefault()
      handleOpenInNewTab()
    },
    [handleOpenInNewTab, isActive, onOpenInNewTab]
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
      <ResourceList.ItemLeadingSlot className={cn('relative', !rowState.renaming && channelIcon && 'rounded-sm')}>
        {!rowState.renaming && onTogglePin && (
          <Tooltip title={pinned ? t('chat.topics.unpin') : t('chat.topics.pin')} delay={500}>
            <ResourceList.ItemAction
              aria-label={pinned ? t('chat.topics.unpin') : t('chat.topics.pin')}
              className={cn(pinned && 'text-foreground/70 hover:text-foreground')}
              onClick={handleTogglePinClick}>
              <PinIcon size={13} className={cn(pinned && '-rotate-45')} />
            </ResourceList.ItemAction>
          </Tooltip>
        )}
        {!rowState.renaming && channelIcon ? (
          <img
            src={channelIcon}
            alt=""
            className="pointer-events-none absolute inset-0 m-auto size-3.5 rounded-[2px] object-contain transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0"
          />
        ) : null}
      </ResourceList.ItemLeadingSlot>

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

      <ResourceList.ItemActions active={hasStreamIndicator}>
        {showOpenInNewTabAction && (
          <Tooltip title={t('common.open_in_new_tab')} delay={500}>
            <ResourceList.ItemAction
              aria-label={t('common.open_in_new_tab')}
              onClick={(event) => {
                event.stopPropagation()
                handleOpenInNewTab()
              }}>
              <SquareArrowOutUpRight size={13} />
            </ResourceList.ItemAction>
          </Tooltip>
        )}
        {hasStreamIndicator && <SessionStreamIndicator isFulfilled={isStreamFulfilled} isPending={isStreamPending} />}
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
  const dotClassName = cn('size-[5px] rounded-full', isPending ? 'animation-pulse bg-warning' : 'bg-success')

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
