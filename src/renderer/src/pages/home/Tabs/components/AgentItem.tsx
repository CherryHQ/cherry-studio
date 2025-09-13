import { Avatar, cn } from '@heroui/react'
import { loggerService } from '@logger'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { AgentEntity } from '@renderer/types'
import { Dropdown, MenuProps } from 'antd'
import { FC, memo, useCallback, useMemo } from 'react'
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
  // const { agents } = useAgents()

  const menuItems = useMemo(
    () =>
      getMenuItems({
        agent,
        t,
        onDelete
      }),
    [agent, t, onDelete]
  )

  const AgentLabel = useCallback(() => {
    return (
      <>
        {agent.avatar && <Avatar className="h-6 w-6" src={agent.avatar} />}
        <span className="text-sm">{agent.name}</span>
      </>
    )
  }, [agent.avatar, agent.name])

  const handleClick = () => logger.debug('not implemented')

  return (
    <Dropdown
      menu={{ items: menuItems }}
      trigger={['contextMenu']}
      popupRender={(menu) => <div onPointerDown={(e) => e.stopPropagation()}>{menu}</div>}>
      <Container onClick={handleClick} className={isActive ? 'active' : ''}>
        <AssistantNameRow className="name" title={agent.name}>
          <AgentLabel />
        </AssistantNameRow>
      </Container>
    </Dropdown>
  )
}

// 提取创建菜单配置的函数
function getMenuItems({ agent, t, onDelete }): MenuProps['items'] {
  return [
    {
      label: t('common.edit'),
      key: 'edit',
      icon: <EditIcon size={14} />,
      onClick: () => window.toast.info('not implemented')
    },
    {
      label: t('common.delete'),
      key: 'delete',
      icon: <DeleteIcon size={14} className="lucide-custom" />,
      danger: true,
      onClick: () => {
        window.modal.confirm({
          title: t('agent.delete.title'),
          content: t('agent.delete.content'),
          centered: true,
          okButtonProps: { danger: true },
          onOk: () => onDelete(agent)
        })
      }
    }
  ]
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

// const MenuButton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
//   <div
//     {...props}
//     className={cn(
//       'flex flex-row items-center justify-center',
//       'h-[22px] min-h-[22px] min-w-[22px]',
//       'absolute rounded-[11px]',
//       'bg-[var(--color-background)]',
//       'top-[6px] right-[9px]',
//       'px-[5px]',
//       'border-[0.5px] border-[var(--color-border)]',
//       className
//     )}
//   />
// )

// const TopicCount: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
//   <div
//     {...props}
//     className={cn(
//       'text-[10px] text-[var(--color-text)]',
//       'rounded-[10px]',
//       'flex flex-row items-center justify-center',
//       className
//     )}
//   />
// )

export default memo(AgentItem)
