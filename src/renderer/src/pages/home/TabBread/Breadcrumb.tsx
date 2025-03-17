import { useAssistant, useAssistants } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { getTopicById } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Assistant, Topic } from '@renderer/types'
import { Breadcrumb as AntBreadcrumb, List, Popover } from 'antd'
import { useCallback, useState } from 'react'
import styled from 'styled-components'

interface BreadcrumbProps {
  activeAssistantId: string
  activeTopicId: string
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant?: (assistant: Assistant) => void
}

const BreadcrumbContainer = styled.div`
  padding: 8px 8px;
  background-color: var(--color-bg-2);

  .ant-breadcrumb-link {
    cursor: pointer;
    display: flex;
    align-items: center;

    &:hover {
      color: var(--color-primary);
    }
  }

  .breadcrumb-emoji {
    margin-right: 6px;
  }
`

const PopoverContent = styled.div`
  width: 200px;
  max-height: 300px;
  overflow-y: auto;
  padding: 0;

  .ant-list {
    margin: 0;
    padding: 0;
  }

  .ant-list-item {
    margin: 0;
    padding: 0;
    border: none;
  }
`

const ListItemContainer = styled.div`
  display: flex;
  align-items: center;
  padding: 4px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  font-family: Ubuntu;
  width: 100%;

  &:hover {
    background-color: var(--color-background-soft);
  }

  &.active {
    background-color: var(--color-background-soft);
  }
`

const BreadcrumbNavigator: React.FC<BreadcrumbProps> = ({
  activeAssistantId,
  activeTopicId,
  setActiveTopic,
  setActiveAssistant
}) => {
  const [assistantPopoverVisible, setAssistantPopoverVisible] = useState(false)
  const [topicPopoverVisible, setTopicPopoverVisible] = useState(false)

  const { assistants, findAssistantByTopicId } = useAssistants()
  const { assistant } = useAssistant(activeAssistantId)
  const { topicPosition } = useSettings()

  const currentTopic = assistant?.topics?.find((topic) => topic.id === activeTopicId)

  const handleAssistantChange = useCallback(
    (assistant: Assistant) => {
      if (setActiveAssistant && assistant.id !== activeAssistantId) {
        setActiveAssistant(assistant)
        // 如果助手有话题，自动选择第一个话题
        if (assistant.topics && assistant.topics.length > 0) {
          setActiveTopic(assistant.topics[0])
        }
      }
      setAssistantPopoverVisible(false)
    },
    [activeAssistantId, setActiveAssistant, setActiveTopic]
  )

  const handleTopicChange = useCallback(
    async (topicId: string) => {
      if (topicId !== activeTopicId) {
        const topic = await getTopicById(topicId)
        if (topic) {
          const assistant = findAssistantByTopicId(topicId)
          if (assistant && setActiveAssistant && assistant.id !== activeAssistantId) {
            setActiveAssistant(assistant)
          }

          if (topicPosition === 'left') {
            EventEmitter.emit(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR)
          }

          setActiveTopic(topic)
        }
      }
      setTopicPopoverVisible(false)
    },
    [activeTopicId, activeAssistantId, findAssistantByTopicId, setActiveAssistant, topicPosition, setActiveTopic]
  )

  // 助手选择器
  const assistantSelector = (
    <PopoverContent>
      <List
        dataSource={assistants}
        renderItem={(assistant) => (
          <List.Item onClick={() => handleAssistantChange(assistant)}>
            <ListItemContainer className={assistant.id === activeAssistantId ? 'active' : ''}>
              <span>{assistant.name}</span>
            </ListItemContainer>
          </List.Item>
        )}
      />
    </PopoverContent>
  )

  // 话题选择器
  const topicSelector = (
    <PopoverContent>
      <List
        dataSource={assistant?.topics || []}
        renderItem={(topic) => (
          <List.Item onClick={() => handleTopicChange(topic.id)}>
            <ListItemContainer className={topic.id === activeTopicId ? 'active' : ''}>
              <span>{topic.name}</span>
            </ListItemContainer>
          </List.Item>
        )}
      />
    </PopoverContent>
  )

  return (
    <BreadcrumbContainer>
      <AntBreadcrumb separator=">" style={{ fontSize: '13px', fontFamily: 'Ubuntu' }}>
        <AntBreadcrumb.Item>
          <Popover
            content={assistantSelector}
            trigger="click"
            open={assistantPopoverVisible}
            onOpenChange={setAssistantPopoverVisible}
            placement="bottom">
            <span>{assistant?.name}</span>
          </Popover>
        </AntBreadcrumb.Item>

        <AntBreadcrumb.Item>
          <Popover
            content={topicSelector}
            trigger="click"
            open={topicPopoverVisible}
            onOpenChange={setTopicPopoverVisible}
            placement="bottom">
            <span>{currentTopic?.name}</span>
          </Popover>
        </AntBreadcrumb.Item>
      </AntBreadcrumb>
    </BreadcrumbContainer>
  )
}

export default BreadcrumbNavigator
