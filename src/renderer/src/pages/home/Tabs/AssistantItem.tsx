import { DeleteOutlined, EditOutlined, MinusCircleOutlined, SaveOutlined } from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { getDefaultModel, getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Assistant } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Dropdown } from 'antd'
import { ItemType } from 'antd/es/menu/interface'
import { omit } from 'lodash'
import { FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface AssistantItemProps {
  assistant: Assistant
  isActive: boolean
  onSwitch: (assistant: Assistant) => void
  onDelete: (assistant: Assistant) => void
  onCreateDefaultAssistant: () => void
  addAgent: (agent: any) => void
  addAssistant: (assistant: Assistant) => void
}

const AssistantItem: FC<AssistantItemProps> = ({ assistant, isActive, onSwitch, onDelete, addAgent, addAssistant }) => {
  const { t } = useTranslation()
  const { removeAllTopics } = useAssistant(assistant.id) // 使用当前助手的ID
  const { clickAssistantToShowTopic, topicPosition, showAssistantIcon } = useSettings()
  const defaultModel = getDefaultModel()

  const getMenuItems = useCallback(
    (assistant: Assistant): ItemType[] => [
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
      },
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
            onOk: () => onDelete(assistant)
          })
        }
      }
    ],
    [addAgent, addAssistant, onSwitch, removeAllTopics, t, onDelete]
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
  padding: 7px 10px;
  position: relative;
  margin: 0 10px;
  font-family: Ubuntu;
  border-radius: var(--list-item-border-radius);
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
