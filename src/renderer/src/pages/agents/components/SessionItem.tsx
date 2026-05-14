import { Tooltip } from '@cherrystudio/ui'
import { ResourceList, useResourceList } from '@renderer/components/chat/resources'
import { isMac } from '@renderer/config/constant'
import { useCache } from '@renderer/data/hooks/useCache'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { buildAgentSessionTopicId, getChannelTypeIcon } from '@renderer/utils/agentSession'
import { cn } from '@renderer/utils/style'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import { PinIcon, Trash2, XIcon } from 'lucide-react'
import type { MouseEvent } from 'react'
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SessionActionContext } from './sessionItemActions'
import { useSessionMenuActions } from './useSessionMenuActions'

interface SessionItemProps {
  channelType?: string
  onDelete: (id: string) => void | Promise<void>
  onPress: (id: string) => void
  onSelectItem?: () => void
  onTogglePin?: (id: string) => void | Promise<void>
  pinned?: boolean
  session: AgentSessionEntity
}

const DELETE_CONFIRMATION_TIMEOUT = 3000

const SessionItem = ({
  channelType,
  onDelete,
  onPress,
  onSelectItem,
  onTogglePin,
  pinned = false,
  session
}: SessionItemProps) => {
  const { t } = useTranslation()
  const context = useResourceList<AgentSessionEntity>()
  const topicId = useMemo(() => buildAgentSessionTopicId(session.id), [session.id])
  const [renamingTopics] = useCache('topic.renaming')
  const [newlyRenamedTopics] = useCache('topic.newly_renamed')
  const { isFulfilled: isStreamFulfilled, isPending: isStreamPending, markSeen } = useTopicStreamStatus(topicId)
  const [isConfirmingDeletion, setIsConfirmingDeletion] = useState(false)
  const deleteConfirmationTimeoutRef = useRef<number | null>(null)
  const channelIcon = getChannelTypeIcon(channelType)
  const isActive = context.state.selectedId === session.id
  const sessionName = session.name ?? session.id
  const isRenaming = renamingTopics?.includes(topicId) === true
  const isNewlyRenamed = newlyRenamedTopics?.includes(topicId) === true
  const nameAnimationClassName = isRenaming ? 'animation-shimmer' : isNewlyRenamed ? 'animation-reveal' : ''
  const hasStreamIndicator = !isActive && (isStreamPending || isStreamFulfilled)

  const startEdit = useCallback(() => context.actions.startRename(session.id), [context.actions, session.id])
  const handleDelete = useCallback(() => {
    void onDelete(session.id)
  }, [onDelete, session.id])
  const handleTogglePin = useCallback(() => {
    void onTogglePin?.(session.id)
  }, [onTogglePin, session.id])

  const actionContext = useMemo<SessionActionContext>(
    () => ({
      onDelete: handleDelete,
      onTogglePin: onTogglePin ? handleTogglePin : undefined,
      pinned,
      sessionName: session.name ?? '',
      startEdit,
      t
    }),
    [handleDelete, handleTogglePin, onTogglePin, pinned, session.name, startEdit, t]
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

  const handlePress = useCallback(() => {
    onPress(session.id)
    onSelectItem?.()
  }, [onPress, onSelectItem, session.id])

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
      className={cn('relative', isActive && 'bg-sidebar-accent')}
      style={{ cursor: 'pointer' }}
      onClick={handlePress}
      title={sessionName}>
      <Tooltip title={pinned ? t('chat.topics.unpin') : t('chat.topics.pin')} delay={500}>
        <ResourceList.ItemLeadingAction
          aria-label={pinned ? t('chat.topics.unpin') : t('chat.topics.pin')}
          className={cn(pinned && 'text-muted-foreground/55 hover:text-muted-foreground/75')}
          onClick={handleTogglePinClick}>
          {pinned ? <PinIcon size={13} className="-rotate-45" /> : <PinIcon size={13} />}
        </ResourceList.ItemLeadingAction>
      </Tooltip>

      <ResourceList.RenameField
        item={session}
        aria-label={t('agent.session.edit.title')}
        onClick={(event) => event.stopPropagation()}
      />

      {context.state.renamingId !== session.id && (
        <>
          {channelIcon && (
            <ResourceList.ItemIcon className="size-4 rounded-sm">
              <img src={channelIcon} alt="" className="size-3.5 rounded-[2px] object-contain" />
            </ResourceList.ItemIcon>
          )}
          <ResourceList.ItemTitle
            title={sessionName}
            className={nameAnimationClassName}
            onDoubleClick={(event) => {
              event.stopPropagation()
              startEdit()
            }}>
            {sessionName}
          </ResourceList.ItemTitle>
        </>
      )}

      {hasStreamIndicator ? (
        <SessionStreamIndicator isFulfilled={isStreamFulfilled} isPending={isStreamPending} />
      ) : (
        <Tooltip
          placement="bottom"
          delay={700}
          title={
            <span className="text-xs italic opacity-80">
              {t('chat.topics.delete.shortcut', { key: isMac ? '⌘' : 'Ctrl' })}
            </span>
          }>
          <ResourceList.ItemAction
            aria-label={t('common.delete')}
            data-deleting={isConfirmingDeletion}
            onClick={handleDeleteClick}>
            {isConfirmingDeletion ? <Trash2 size={14} className="text-destructive" /> : <XIcon size={14} />}
          </ResourceList.ItemAction>
        </Tooltip>
      )}
    </ResourceList.Item>
  )

  return (
    <ResourceList.ContextMenu item={session} actions={menuActions} onAction={handleMenuAction}>
      {row}
    </ResourceList.ContextMenu>
  )
}

const SessionStreamIndicator = ({ isFulfilled, isPending }: { isFulfilled: boolean; isPending: boolean }) => {
  const dotClassName = cn('animation-pulse size-[5px] rounded-full', isPending ? 'bg-warning' : 'bg-success')

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
