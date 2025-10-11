import { Button, Chip, cn } from '@heroui/react'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import AgentSettingsPopup from '@renderer/pages/settings/AgentSettings/AgentSettingsPopup'
import { AgentLabel } from '@renderer/pages/settings/AgentSettings/shared'
import type { AgentEntity } from '@renderer/types'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@renderer/ui/context-menu'
import { type FC, memo } from 'react'
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
  const { sessions } = useSessions(agent.id)

  return (
    <>
      <ContextMenu modal={false}>
        <ContextMenuTrigger>
          <ButtonContainer onPress={onPress} className={isActive ? 'active' : ''}>
            <AssistantNameRow className="name flex w-full justify-between" title={agent.name ?? agent.id}>
              <AgentLabel agent={agent} />
              {isActive && (
                <Chip
                  variant="bordered"
                  size="sm"
                  radius="full"
                  className="aspect-square h-5 w-5 items-center justify-center border-[0.5px] bg-background text-[10px]">
                  {sessions.length}
                </Chip>
              )}
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
      'bg-transparent hover:bg-[var(--color-list-item)] hover:shadow-sm',
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
