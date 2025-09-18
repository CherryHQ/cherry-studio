import { Button, cn, useDisclosure } from '@heroui/react'
import { loggerService } from '@logger'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { AgentSessionEntity } from '@renderer/types'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@renderer/ui/context-menu'
import { FC, memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('AgentItem')

interface SessionItemProps {
  session: AgentSessionEntity
  isActive: boolean
  onDelete: (session: AgentSessionEntity) => void
  onPress: () => void
}

const SessionItem: FC<SessionItemProps> = ({ session, isActive, onDelete, onPress }) => {
  const { t } = useTranslation()
  // const { isOpen, onOpen, onClose } = useDisclosure()
  const { onOpen } = useDisclosure()

  const SessionLabel = useCallback(() => {
    const displayName = session.name ?? session.id
    return (
      <Button onPress={onPress}>
        <span className="text-sm">{displayName}</span>
      </Button>
    )
  }, [session.id, session.name, onPress])

  const handleClick = () => logger.debug('not implemented')

  return (
    <>
      <ContextMenu modal={false}>
        <ContextMenuTrigger>
          <Container onClick={handleClick} className={isActive ? 'active' : ''}>
            <SessionLabelContainer className="name" title={session.name ?? session.id}>
              <SessionLabel />
            </SessionLabelContainer>
          </Container>
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
              window.modal.confirm({
                title: t('agent.session.delete.title'),
                content: t('agent.session.delete.content'),
                centered: true,
                okButtonProps: { danger: true },
                onOk: () => onDelete(session)
              })
            }}>
            <DeleteIcon size={14} className="lucide-custom text-danger" />
            <span className="text-danger">{t('common.delete')}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {/* TODO: Add a session modal here */}
    </>
  )
}

const Container: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    {...props}
    className={cn(
      'relative flex h-[37px] flex-row justify-between p-2',
      'rounded-[var(--list-item-border-radius)]',
      'border-[0.5px] border-transparent',
      'w-[calc(var(--assistants-width)_-_20px)]',
      'hover:bg-[var(--color-list-item-hover)]',
      'cursor-pointer',
      className?.includes('active') && 'bg-[var(--color-list-item)] shadow-sm',
      className
    )}
  />
)

const SessionLabelContainer: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    {...props}
    className={cn('text-[13px] text-[var(--color-text)]', 'flex flex-row items-center gap-2', className)}
  />
)

export default memo(SessionItem)
