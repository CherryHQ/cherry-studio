import { DeleteOutlined, EditOutlined, MessageOutlined, MinusCircleOutlined, SaveOutlined } from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { useActiveTopicContext } from '@renderer/context/ActiveTopicContext'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useTopicsQueueStateWithEvent } from '@renderer/hooks/useQueue'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { getDefaultModel } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Assistant } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Dropdown } from 'antd'
import { ItemType } from 'antd/es/menu/interface'
import { omit } from 'lodash'
import { FC, startTransition, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface AssistantItemProps {
  assistant: Assistant
  isActive: boolean
  onSwitch: (assistant: Assistant | null) => void
  onDelete: (assistant: Assistant) => void
  onCreateDefaultAssistant: () => void
  addAgent: (agent: any) => void
  addAssistant: (assistant: Assistant) => void
}

const AssistantItem: FC<AssistantItemProps> = ({ assistant, isActive, onSwitch, onDelete, addAgent, addAssistant }) => {
  const { t } = useTranslation()
  const { clickAssistantToShowTopic, topicPosition, showAssistantIcon } = useSettings()
  const defaultModel = getDefaultModel()

  const { setActiveTopic } = useActiveTopicContext()
  const { topics, removeAllTopics } = useAssistant(assistant.id)

  // 使用基于事件的Hook监听队列状态
  const isChatting = useTopicsQueueStateWithEvent(topics)

  const getMenuItems = useCallback(
    (assistant: Assistant): ItemType[] => [
      {
        label: t('assistants.new_topic.title'),
        key: 'new_topic',
        icon: <MessageOutlined />,
        onClick: async () => {
          EventEmitter.emit(EVENT_NAMES.ADD_NEW_TOPIC, assistant.id)
        }
      },
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
          addAssistant({ ...assistant, id: uuid() })
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
          if (topics.length > 0) {
            window.modal.warning({
              title: t('assistants.delete.has_topics.title'),
              content: t('assistants.delete.has_topics.content', { count: topics.length }),
              centered: true
            })
          } else {
            window.modal.confirm({
              title: t('assistants.delete.title'),
              content: (
                <div>
                  <span>
                    {t('assistants.delete.double_check_name')}
                    {assistant.emoji ? assistant.emoji : ''}
                    {assistant.name}
                  </span>
                  <div>{t('assistants.delete.content')}</div>
                </div>
              ),
              centered: true,
              okButtonProps: { danger: true },
              onOk: () => onDelete(assistant)
            })
          }
        }
      }
    ],
    [t, addAssistant, removeAllTopics, addAgent, topics.length, onDelete]
  )

  // 在这里“切换”助手只是筛选话题列表，这尽量保持了以前的行为
  const handleSwitch = useCallback(async () => {
    // 取消选中，不筛选话题
    if (isActive) {
      onSwitch(null)
      return
    }

    if (topics.length === 0) {
      window.message.warning({
        content: t('assistants.no_topics.title'),
        key: 'no-topics'
      })
      return
    }

    await modelGenerating()

    if (clickAssistantToShowTopic) {
      if (topicPosition === 'left') {
        EventEmitter.emit(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR)
      }
      // 保持以前的行为，“切换”助手也切换话题
      setActiveTopic(topics[0])
    } else {
      startTransition(() => {
        setActiveTopic(topics[0])
      })
    }

    // 仅切换助手
    onSwitch(assistant)
  }, [isActive, topics, topicPosition, clickAssistantToShowTopic, setActiveTopic, onSwitch, assistant, t])

  const assistantName = assistant.name || t('chat.default.name')
  const fullAssistantName = assistant.emoji ? `${assistant.emoji} ${assistantName}` : assistantName

  return (
    <Dropdown menu={{ items: getMenuItems(assistant) }} trigger={['contextMenu']}>
      <Container onClick={handleSwitch} className={isActive ? 'active' : ''}>
        <AssistantNameRow className="name" title={fullAssistantName}>
          {showAssistantIcon && (
            <ModelAvatar
              model={assistant.model || defaultModel}
              size={22}
              className={isChatting ? 'animation-pulse' : ''}
            />
          )}
          <AssistantName className="text-nowrap">{showAssistantIcon ? assistantName : fullAssistantName}</AssistantName>
        </AssistantNameRow>
        <MenuButton onClick={() => EventEmitter.emit(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR)}>
          <TopicCount className="topics-count">{topics.length}</TopicCount>
        </MenuButton>
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
  font-family: Ubuntu;
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid transparent;
  width: calc(var(--assistants-width) - 20px);
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
