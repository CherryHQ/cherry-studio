import { Button, cn, useDisclosure } from '@heroui/react'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { SessionModal } from '@renderer/components/Popups/agent/SessionModal'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { AgentSessionEntity } from '@renderer/types'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@renderer/ui/context-menu'
import { FC, memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

// const logger = loggerService.withContext('AgentItem')

interface SessionItemProps {
  session: AgentSessionEntity
  // use external agentId as SSOT, instead of session.agent_id
  agentId: string
  isDisabled?: boolean
  isLoading?: boolean
  onDelete: () => void
  onPress: () => void
}

const SessionItem: FC<SessionItemProps> = ({ session, agentId, isDisabled, isLoading, onDelete, onPress }) => {
  const { t } = useTranslation()
  const { isOpen, onOpen, onClose } = useDisclosure()
  const { chat } = useRuntime()
  const activeSessionId = chat.activeSessionId[agentId]

  const isActive = activeSessionId === session.id

  const SessionLabel = useCallback(() => {
    const displayName = session.name ?? session.id
    return (
      <>
        <span className="text-sm">{displayName}</span>
      </>
    )
  }, [session.id, session.name])

  return (
    <>
      <ContextMenu modal={false}>
        <ContextMenuTrigger>
          <ButtonContainer
            isDisabled={isDisabled}
            isLoading={isLoading}
            onPress={onPress}
            className={isActive ? 'active' : ''}>
            <SessionLabelContainer className="name" title={session.name ?? session.id}>
              <SessionLabel />
            </SessionLabelContainer>
          </ButtonContainer>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            key="edit"
            onClick={() => {
              onOpen()
            }}>
            <EditIcon size={14} />
            {t('common.edit')}
          </ContextMenuItem>
          <ContextMenuItem
            key="delete"
            className="text-danger"
            onClick={() => {
              onDelete()
            }}>
            <DeleteIcon size={14} className="lucide-custom text-danger" />
            <span className="text-danger">{t('common.delete')}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <SessionModal agentId={agentId} isOpen={isOpen} onClose={onClose} session={session} />
    </>
  )
}

const ButtonContainer: React.FC<React.ComponentProps<typeof Button>> = ({ className, children, ...props }) => (
  <Button
    {...props}
    className={cn(
      'relative mb-2 flex h-[37px] flex-row justify-between p-2.5',
      'rounded-[var(--list-item-border-radius)]',
      'border-[0.5px] border-transparent',
      'w-[calc(var(--assistants-width)_-_20px)]',
      'bg-transparent hover:bg-[var(--color-list-item-hover)]',
      'cursor-pointer',
      className?.includes('active') && 'bg-[var(--color-list-item)] shadow-sm',
      className
    )}>
    {children}
  </Button>
)

const SessionLabelContainer: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    {...props}
    className={cn('text-[13px] text-[var(--color-text)]', 'flex flex-row items-center gap-2', className)}
  />
)

export default memo(SessionItem)
