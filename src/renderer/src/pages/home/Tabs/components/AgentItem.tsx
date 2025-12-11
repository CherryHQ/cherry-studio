import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { useSettings } from '@renderer/hooks/useSettings'
import AgentSettingsPopup from '@renderer/pages/settings/AgentSettings/AgentSettingsPopup'
import { AgentLabel } from '@renderer/pages/settings/AgentSettings/shared'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { AgentEntity } from '@renderer/types'
import { cn } from '@renderer/utils'
import type { MenuProps } from 'antd'
import { Dropdown, Tooltip } from 'antd'
import { Bot, MoreVertical } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback, useMemo } from 'react'
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
  const { clickAssistantToShowTopic, topicPosition, assistantIconType } = useSettings()

  const handlePress = useCallback(() => {
    // Show session sidebar if setting is enabled (reusing the assistant setting for consistency)
    if (clickAssistantToShowTopic) {
      if (topicPosition === 'left') {
        EventEmitter.emit(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR)
      }
    }
    onPress()
  }, [clickAssistantToShowTopic, topicPosition, onPress])

  const handleMoreClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      AgentSettingsPopup.show({ agentId: agent.id })
    },
    [agent.id]
  )

  const menuItems: MenuProps['items'] = useMemo(
    () => [
      {
        label: t('common.edit'),
        key: 'edit',
        icon: <EditIcon size={14} />,
        onClick: () => AgentSettingsPopup.show({ agentId: agent.id })
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
    ],
    [t, agent, onDelete]
  )

  return (
    <Dropdown
      menu={{ items: menuItems }}
      trigger={['contextMenu']}
      popupRender={(menu) => <div onPointerDown={(e) => e.stopPropagation()}>{menu}</div>}>
      <Container onClick={handlePress} isActive={isActive}>
        <AssistantNameRow className="name" title={agent.name ?? agent.id}>
          <AgentNameWrapper>
            <AgentLabel agent={agent} hideIcon={assistantIconType === 'none'} />
          </AgentNameWrapper>
          {isActive && (
            <MenuButton onClick={handleMoreClick}>
              <MoreVertical size={14} className="text-[var(--color-text-secondary)]" />
            </MenuButton>
          )}
          {!isActive && assistantIconType !== 'none' && <BotIcon />}
        </AssistantNameRow>
      </Container>
    </Dropdown>
  )
}

export const Container: React.FC<{ isActive?: boolean } & React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  isActive,
  ...props
}) => (
  <div
    className={cn(
      'relative flex h-[37px] w-[calc(var(--assistants-width)-20px)] cursor-pointer flex-row justify-between rounded-[var(--list-item-border-radius)] border border-transparent px-2',
      !isActive && 'hover:bg-[var(--color-list-item-hover)]',
      isActive && 'bg-[var(--color-list-item)] shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]',
      className
    )}
    {...props}
  />
)

export const AssistantNameRow: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn('flex min-w-0 flex-1 flex-row items-center gap-2 text-[13px] text-[var(--color-text)]', className)}
    {...props}
  />
)

export const AgentNameWrapper: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap', className)} {...props} />
)

export const MenuButton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn(
      'flex h-[22px] min-h-[22px] min-w-[22px] flex-row items-center justify-center rounded-[11px] border-[0.5px] border-[var(--color-border)] bg-[var(--color-background)] px-[5px]',
      className
    )}
    {...props}
  />
)

export const BotIcon: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ ...props }) => {
  const { t } = useTranslation()
  return (
    <Tooltip title={t('common.agent_one')} mouseEnterDelay={0.5}>
      <MenuButton {...props}>
        <Bot size={14} className="text-primary" />
      </MenuButton>
    </Tooltip>
  )
}

export const SessionCount: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn('flex flex-row items-center justify-center rounded-full text-[var(--color-text)] text-xs', className)}
    {...props}
  />
)

export default memo(AgentItem)
