import { ContextMenuSub, Tooltip } from '@cherrystudio/ui'
import { ResourceList, useResourceList } from '@renderer/components/chat/resources'
import { isMac } from '@renderer/config/constant'
import { getChannelTypeIcon } from '@renderer/utils/agentSession'
import { cn } from '@renderer/utils/style'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import { MenuIcon, PinIcon, Trash2, XIcon } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { memo, startTransition, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { executeSessionMenuAction, resolveSessionMenuActions, type SessionActionContext } from './sessionItemActions'

export type SessionStreamState = {
  isFulfilled: boolean
  isPending: boolean
}

interface SessionItemProps {
  channelType?: string
  isNewlyRenamed?: boolean
  isRenaming?: boolean
  onDelete: () => void
  onPress: () => void
  onTogglePin?: () => void
  pinned?: boolean
  session: AgentSessionEntity
  streamStatus?: SessionStreamState
}

const DELETE_CONFIRMATION_TIMEOUT = 3000

const SessionItem = ({
  channelType,
  isNewlyRenamed = false,
  isRenaming = false,
  onDelete,
  onPress,
  onTogglePin,
  pinned = false,
  session,
  streamStatus
}: SessionItemProps) => {
  const { t } = useTranslation()
  const context = useResourceList<AgentSessionEntity>()
  const [isConfirmingDeletion, setIsConfirmingDeletion] = useState(false)
  const channelIcon = getChannelTypeIcon(channelType)
  const isActive = context.state.selectedId === session.id
  const sessionName = session.name ?? session.id
  const nameAnimationClassName = isRenaming ? 'animation-shimmer' : isNewlyRenamed ? 'animation-reveal' : ''
  const hasStreamIndicator = !isActive && (streamStatus?.isPending === true || streamStatus?.isFulfilled === true)

  const startEdit = useCallback(() => context.actions.startRename(session.id), [context.actions, session.id])

  const actionContext = useMemo<SessionActionContext>(
    () => ({
      onDelete,
      onTogglePin,
      pinned,
      sessionName: session.name ?? '',
      startEdit,
      t
    }),
    [onDelete, onTogglePin, pinned, session.name, startEdit, t]
  )

  const menuActions = useMemo(() => resolveSessionMenuActions(actionContext), [actionContext])

  const handleMenuAction = useCallback(
    async (action: (typeof menuActions)[number]) => {
      await executeSessionMenuAction(action, actionContext)
    },
    [actionContext]
  )

  const handleDeleteClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation()

      if (isConfirmingDeletion || event.ctrlKey || event.metaKey) {
        onDelete()
        return
      }

      startTransition(() => {
        setIsConfirmingDeletion(true)
        window.setTimeout(() => setIsConfirmingDeletion(false), DELETE_CONFIRMATION_TIMEOUT)
      })
    },
    [isConfirmingDeletion, onDelete]
  )

  const row = (
    <ResourceList.Item
      item={session}
      data-testid="agent-session-row"
      className={cn('relative', isActive && 'bg-sidebar-accent')}
      style={{ cursor: 'pointer' }}
      onClick={onPress}
      title={sessionName}>
      <Tooltip title={pinned ? t('chat.topics.unpin') : t('chat.topics.pin')} delay={500}>
        <ResourceList.ItemLeadingAction
          aria-label={pinned ? t('chat.topics.unpin') : t('chat.topics.pin')}
          data-active={pinned || undefined}
          className={cn(pinned && 'text-muted-foreground/55 hover:text-muted-foreground/75')}
          onClick={(event) => {
            event.stopPropagation()
            onTogglePin?.()
          }}>
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
        <SessionStreamIndicator
          isFulfilled={streamStatus?.isFulfilled === true}
          isPending={streamStatus?.isPending === true}
        />
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
    <ResourceList.ContextMenu
      item={session}
      content={<SessionContextMenu actions={menuActions} onAction={handleMenuAction} />}>
      {row}
    </ResourceList.ContextMenu>
  )
}

function SessionContextMenu({
  actions,
  onAction
}: {
  actions: ReturnType<typeof resolveSessionMenuActions>
  onAction: (action: ReturnType<typeof resolveSessionMenuActions>[number]) => Promise<void>
}) {
  const actionItems: ReactNode[] = []

  actions.forEach((action) => {
    if (action.children.length > 0) {
      actionItems.push(
        <ContextMenuSub key={action.id}>
          <ResourceList.ContextMenuSubAction icon={action.icon ?? <MenuIcon />}>
            {action.label}
          </ResourceList.ContextMenuSubAction>
          <ResourceList.ContextMenuSubContent>
            {action.children.map((child) => (
              <ResourceList.ContextMenuAction
                key={child.id}
                disabled={!child.availability.enabled}
                icon={child.icon}
                variant={child.danger ? 'destructive' : undefined}
                onSelect={() => void onAction(child)}>
                {child.label}
              </ResourceList.ContextMenuAction>
            ))}
          </ResourceList.ContextMenuSubContent>
        </ContextMenuSub>
      )
      return
    }

    if (action.group === 'danger' && actionItems.length > 0) {
      actionItems.push(<ResourceList.ContextMenuSeparator key={`${action.id}:separator`} />)
    }

    actionItems.push(
      <ResourceList.ContextMenuAction
        key={action.id}
        disabled={!action.availability.enabled}
        icon={action.icon}
        variant={action.danger ? 'destructive' : undefined}
        onSelect={() => void onAction(action)}>
        {action.label}
      </ResourceList.ContextMenuAction>
    )
  })

  return <>{actionItems}</>
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
