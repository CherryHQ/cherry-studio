import { Avatar, cn, useDisclosure } from '@heroui/react'
import { loggerService } from '@logger'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { AgentModal } from '@renderer/components/Popups/AgentModal'
import { getAgentAvatar } from '@renderer/config/agent'
import { AgentEntity } from '@renderer/types'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@renderer/ui/context-menu'
import { FC, memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('AgentItem')

interface AgentItemProps {
  agent: AgentEntity
  isActive: boolean
  onDelete: (agent: AgentEntity) => void
  onTagClick?: (tag: string) => void
}

const AgentItem: FC<AgentItemProps> = ({ agent, isActive, onDelete }) => {
  const { t } = useTranslation()
  const { isOpen, onOpen, onClose } = useDisclosure()
  // const { agents } = useAgents()

  const AgentLabel = useCallback(() => {
    const displayName = agent.name ?? agent.id
    const avatar = getAgentAvatar(agent.type)
    return (
      <>
        <Avatar className="h-6 w-6" src={avatar} name={displayName} />
        <span className="text-sm">{displayName}</span>
      </>
    )
  }, [agent.id, agent.name, agent.type])

  const handleClick = () => logger.debug('not implemented')

  return (
    <>
      <ContextMenu modal={false}>
        <ContextMenuTrigger>
          <Container onClick={handleClick} className={isActive ? 'active' : ''}>
            <AssistantNameRow className="name" title={agent.name ?? agent.id}>
              <AgentLabel />
            </AssistantNameRow>
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
                title: t('agent.delete.title'),
                content: t('agent.delete.content'),
                centered: true,
                okButtonProps: { danger: true },
                onOk: () => onDelete(agent)
              })
            }}>
            <DeleteIcon size={14} className="lucide-custom text-danger" />
            <span className="text-danger">{t('common.delete')}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <AgentModal isOpen={isOpen} onClose={onClose} agent={agent} />
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

const AssistantNameRow: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    {...props}
    className={cn('text-[13px] text-[var(--color-text)]', 'flex flex-row items-center gap-2', className)}
  />
)

export default memo(AgentItem)
