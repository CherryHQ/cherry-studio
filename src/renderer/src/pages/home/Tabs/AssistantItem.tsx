import { DeleteOutlined, EditOutlined, FolderOutlined, MinusCircleOutlined, SaveOutlined } from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { getDefaultModel, getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Assistant, AssistantGroup } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Dropdown } from 'antd'
import { ItemType } from 'antd/es/menu/interface'
import { omit } from 'lodash'
import { FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface AssistantItemProps {
  /** 助手信息 */
  assistant: Assistant
  /** 是否激活 */
  isActive?: boolean
  /** 切换助手的回调 */
  onSwitch: (assistant: Assistant) => void
  /** 添加代理的回调 */
  addAgent: (agent: any) => void
  /** 添加助手的回调 */
  addAssistant: (assistant: Assistant) => void
  /** 创建默认助手的回调，用于空状态显示 */
  onCreateDefaultAssistant?: () => void
  /** 移动到分组的回调 */
  onMoveToGroup?: (assistantId: string, groupId?: string) => void
  /** 所有分组列表 */
  groups?: AssistantGroup[]
}

const AssistantItem: FC<AssistantItemProps> = ({
  assistant,
  isActive,
  onSwitch,
  addAgent,
  addAssistant,
  onMoveToGroup,
  groups = []
}) => {
  const { t } = useTranslation()
  const { removeAllTopics } = useAssistant(assistant.id) // 使用当前助手的ID
  const { clickAssistantToShowTopic, topicPosition, showAssistantIcon } = useSettings()
  const defaultModel = getDefaultModel()
  const { removeAssistant } = useAssistants()

  const getMenuItems = useCallback(
    (assistant: Assistant): ItemType[] => {
      const baseItems: ItemType[] = [
        {
          label: t('assistants.edit.title'),
          key: 'edit',
          icon: <EditOutlined />,
          onClick: () => AssistantSettingsPopup.show({ assistant })
        },
        {
          label: t('assistants.copy.title'),
          key: 'duplicate',
          icon: <CopyIcon />,
          onClick: async () => {
            const _assistant: Assistant = { ...assistant, id: uuid(), topics: [getDefaultTopic(assistant.id)] }
            addAssistant(_assistant)
            onSwitch(_assistant)
          }
        },
        {
          label: t('assistants.clear.title'),
          key: 'clear',
          icon: <MinusCircleOutlined />,
          onClick: () => {
            window.modal.confirm({
              title: t('assistants.clear.title'),
              content: t('assistants.clear.content'),
              centered: true,
              okButtonProps: { danger: true },
              onOk: () => removeAllTopics() // 使用当前助手的removeAllTopics
            })
          }
        },
        {
          label: t('assistants.save.title'),
          key: 'save-to-agent',
          icon: <SaveOutlined />,
          onClick: async () => {
            const agent = omit(assistant, ['model', 'emoji'])
            agent.id = uuid()
            agent.type = 'agent'
            addAgent(agent)
            window.message.success({
              content: t('assistants.save.success'),
              key: 'save-to-agent'
            })
          }
        }
      ]

      // 添加移至分组菜单
      if (onMoveToGroup && groups.length > 0) {
        const groupItems: ItemType[] = [
          {
            type: 'divider'
          },
          {
            label: t('assistants.move_to_group'),
            key: 'move-to-group',
            icon: <FolderOutlined />,
            children: [
              // 只有当助手已经在某个分组中时，才显示"移出分组"选项
              ...(assistant.groupId
                ? [
                    {
                      label: t('assistants.move_to_no_group'),
                      key: 'move-to-no-group',
                      onClick: () => onMoveToGroup(assistant.id, undefined)
                    }
                  ]
                : []),
              ...groups.map((group) => ({
                label: group.name,
                key: `move-to-group-${group.id}`,
                onClick: () => onMoveToGroup(assistant.id, group.id),
                disabled: assistant.groupId === group.id // 如果已经在这个组里，禁用该选项
              }))
            ]
          }
        ]

        baseItems.push(...groupItems)
      }

      baseItems.push(
        { type: 'divider' },
        {
          label: t('common.delete'),
          key: 'delete',
          icon: <DeleteOutlined />,
          danger: true,
          onClick: () => {
            window.modal.confirm({
              title: t('assistants.delete.title'),
              content: t('assistants.delete.content'),
              centered: true,
              okButtonProps: { danger: true },
              onOk: () => removeAssistant(assistant.id)
            })
          }
        }
      )

      return baseItems
    },
    [addAgent, addAssistant, onSwitch, removeAllTopics, removeAssistant, t, onMoveToGroup, groups]
  )

  const handleSwitch = useCallback(async () => {
    await modelGenerating()

    if (topicPosition === 'left' && clickAssistantToShowTopic) {
      EventEmitter.emit(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR)
    }

    onSwitch(assistant)
  }, [clickAssistantToShowTopic, onSwitch, assistant, topicPosition])

  const assistantName = assistant.name || t('chat.default.name')
  const fullAssistantName = assistant.emoji ? `${assistant.emoji} ${assistantName}` : assistantName

  return (
    <Dropdown menu={{ items: getMenuItems(assistant) }} trigger={['contextMenu']}>
      <Container onClick={handleSwitch} className={isActive ? 'active' : ''}>
        <AssistantNameRow className="name" title={fullAssistantName}>
          {showAssistantIcon && <ModelAvatar model={assistant.model || defaultModel} size={22} />}
          <AssistantName className="text-nowrap">{showAssistantIcon ? assistantName : fullAssistantName}</AssistantName>
        </AssistantNameRow>
        {isActive && (
          <MenuButton onClick={() => EventEmitter.emit(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR)}>
            <TopicCount className="topics-count">{assistant.topics.length}</TopicCount>
          </MenuButton>
        )}
      </Container>
    </Dropdown>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 7px 12px;
  margin-left: 10px;
  margin-right: 4px;
  position: relative;
  border-radius: var(--list-item-border-radius);
  font-family: Ubuntu;
  font-size: 13px;
  border: 0.5px solid transparent;
  cursor: pointer;

  .iconfont {
    opacity: 0;
    color: var(--color-text-3);
  }
  &:hover {
    background-color: var(--color-background-soft);
  }
  &.active {
    background-color: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
    .name {
    }
  }
`

const AssistantNameRow = styled.div`
  color: var(--color-text);
  font-size: 13px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
`

const AssistantName = styled.div``

const MenuButton = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  min-width: 22px;
  height: 22px;
  min-width: 22px;
  min-height: 22px;
  border-radius: 11px;
  position: absolute;
  background-color: var(--color-background);
  right: 9px;
  top: 6px;
  padding: 0 5px;
  border: 0.5px solid var(--color-border);
`

const TopicCount = styled.div`
  color: var(--color-text);
  font-size: 10px;
  border-radius: 10px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
`

export default AssistantItem
