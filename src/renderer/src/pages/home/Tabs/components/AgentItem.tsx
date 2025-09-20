import { Avatar, Button, cn } from '@heroui/react'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { getAgentAvatar } from '@renderer/config/agent'
import AgentSettingsPopup from '@renderer/pages/settings/AgentSettings'
import { AgentEntity } from '@renderer/types'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@renderer/ui/context-menu'
import { FC, memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

// const logger = loggerService.withContext('AgentItem')

interface AgentItemProps {
  agent: AgentEntity
  isActive: boolean
  onDelete: (agent: AgentEntity) => void
  onPress: () => void
}

const AgentItem: FC<AgentItemProps> = ({ agent, isActive, onDelete, onPress }) => {
  const { t } = useTranslation()
  // const { isOpen, onOpen, onClose } = useDisclosure()
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

  return (
    <>
      <ContextMenu modal={false}>
        <ContextMenuTrigger>
          <ButtonContainer onPress={onPress} className={isActive ? 'active' : ''}>
            <AssistantNameRow className="name" title={agent.name ?? agent.id}>
              <AgentLabel />
            </AssistantNameRow>
          </ButtonContainer>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            key="edit"
            onClick={async () => {
              // onOpen()
              await AgentSettingsPopup.show({
                agentId: agent.id
              })
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
      {/* <AgentModal isOpen={isOpen} onClose={onClose} agent={agent} /> */}
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

const AssistantNameRow: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    {...props}
    className={cn('text-[13px] text-[var(--color-text)]', 'flex flex-row items-center gap-2', className)}
  />
)

export default memo(AgentItem)
