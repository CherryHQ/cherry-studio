import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import MarqueeText from '@renderer/components/MarqueeText'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { useSettings } from '@renderer/hooks/useSettings'
import AgentSettingsPopup from '@renderer/pages/settings/AgentSettings/AgentSettingsPopup'
import { AgentLabel, buildResetToolingUpdate } from '@renderer/pages/settings/AgentSettings/shared'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { GetAgentResponse } from '@renderer/types'
import { cn } from '@renderer/utils'
import type { MenuProps } from 'antd'
import { Dropdown, Tooltip } from 'antd'
import { Bot, MoreVertical } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

// const logger = loggerService.withContext('AgentItem')

interface AgentItemProps {
  agent: GetAgentResponse
  isActive: boolean
  onDelete: (agent: GetAgentResponse) => void
  onPress: () => void
}

const AgentItem = ({ agent, isActive, onDelete, onPress }: AgentItemProps) => {
  const { t } = useTranslation()
  const { clickAssistantToShowTopic, topicPosition, assistantIconType } = useSettings()
  const { updateAgent } = useUpdateAgent()
  const [isHovered, setIsHovered] = useState(false)
  const [isResetting, setIsResetting] = useState(false)

  const handlePress = useCallback(() => {
    // Show session sidebar if setting is enabled (reusing the assistant setting for consistency)
    if (clickAssistantToShowTopic) {
      if (topicPosition === 'left') {
        void EventEmitter.emit(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR)
      }
    }
    onPress()
  }, [clickAssistantToShowTopic, topicPosition, onPress])

  const handleMenuButtonClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  const handleResetTooling = useCallback(() => {
    if (isResetting) {
      return
    }

    window.modal.confirm({
      title: t('agent.settings.tooling.reset', 'Reset tools & MCP'),
      content: t(
        'agent.settings.tooling.reset.confirm',
        'This will clear the agent MCP connections and restore the default tool approvals for its current permission mode.'
      ),
      okText: t('common.reset'),
      cancelText: t('common.cancel'),
      centered: true,
      onOk: async () => {
        setIsResetting(true)
        try {
          const selectedMode = agent.configuration?.permission_mode ?? 'default'
          const resetUpdate = buildResetToolingUpdate(selectedMode, agent.tools ?? [])
          await updateAgent({ id: agent.id, ...resetUpdate }, { showSuccessToast: true })
        } finally {
          setIsResetting(false)
        }
      }
    })
  }, [agent.configuration?.permission_mode, agent.id, agent.tools, isResetting, t, updateAgent])

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
      },
      {
        label: t('agent.settings.tooling.reset', 'Reset tools & MCP'),
        key: 'reset-tooling',
        onClick: handleResetTooling
      }
    ],
    [agent, handleResetTooling, onDelete, t]
  )

  return (
    <Dropdown
      menu={{ items: menuItems }}
      trigger={['contextMenu']}
      popupRender={(menu) => <div onPointerDown={(e) => e.stopPropagation()}>{menu}</div>}>
      <Container
        onClick={handlePress}
        isActive={isActive}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}>
        <AssistantNameRow className="name" title={agent.name ?? agent.id}>
          <MarqueeText className="flex min-w-0 flex-1">
            <AgentLabel agent={agent} hideIcon={assistantIconType === 'none'} />
          </MarqueeText>
          {(isActive || isHovered) && (
            <Dropdown
              menu={{ items: menuItems }}
              trigger={['click']}
              popupRender={(menu) => <div onPointerDown={(e) => e.stopPropagation()}>{menu}</div>}>
              <MenuButton onClick={handleMenuButtonClick}>
                <MoreVertical size={14} className="text-(--color-text-secondary)" />
              </MenuButton>
            </Dropdown>
          )}
          {!isActive && !isHovered && assistantIconType !== 'none' && <BotIcon />}
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
      'relative flex h-9.25 w-[calc(var(--assistants-width)-20px)] cursor-pointer flex-row justify-between rounded-(--list-item-border-radius) border border-transparent px-2',
      !isActive && 'hover:bg-(--color-list-item-hover)',
      isActive && 'bg-(--color-list-item) shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]',
      className
    )}
    {...props}
  />
)

export const AssistantNameRow: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn('flex min-w-0 flex-1 flex-row items-center gap-2 text-(--color-text) text-[13px]', className)}
    {...props}
  />
)

export const MenuButton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn(
      'flex h-5.5 min-h-5.5 min-w-5.5 flex-row items-center justify-center rounded-[11px] border-(--color-border) border-[0.5px] bg-(--color-background) px-1.25',
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
    className={cn('flex flex-row items-center justify-center rounded-full text-(--color-text) text-xs', className)}
    {...props}
  />
)

export default memo(AgentItem)
