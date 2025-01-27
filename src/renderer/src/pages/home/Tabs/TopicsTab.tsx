import {
  ClearOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOutlined,
  UploadOutlined
} from '@ant-design/icons'
import DragableList from '@renderer/components/DragableList'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAssistant, useAssistants } from '@renderer/hooks/useAssistant'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { TopicManager } from '@renderer/hooks/useTopic'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import store from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import { Assistant, Topic } from '@renderer/types'
import { exportTopicAsMarkdown, topicToMarkdown } from '@renderer/utils/export'
import { Dropdown, MenuProps } from 'antd'
import dayjs from 'dayjs'
import { findIndex } from 'lodash'
import { FC, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { FixedSizeList as List } from 'react-window'
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd'

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
}

const Topics: FC<Props> = ({ assistant: _assistant, activeTopic, setActiveTopic }) => {
  const { assistants } = useAssistants()
  const { assistant, removeTopic, moveTopic, updateTopic, updateTopics } = useAssistant(_assistant.id)
  const { t } = useTranslation()
  const { showTopicTime, topicPosition } = useSettings()
  const [isDragging, setIsDragging] = useState(false)

  const borderRadius = showTopicTime ? 12 : 'var(--list-item-border-radius)'

  const onDeleteTopic = useCallback(
    async (topic: Topic) => {
      await modelGenerating()
      const index = findIndex(assistant.topics, (t) => t.id === topic.id)
      setActiveTopic(assistant.topics[index + 1 === assistant.topics.length ? 0 : index + 1])
      removeTopic(topic)
    },
    [assistant.topics, removeTopic, setActiveTopic]
  )

  const onMoveTopic = useCallback(
    async (topic: Topic, toAssistant: Assistant) => {
      await modelGenerating()
      const index = findIndex(assistant.topics, (t) => t.id === topic.id)
      setActiveTopic(assistant.topics[index + 1 === assistant.topics.length ? 0 : index + 1])
      moveTopic(topic, toAssistant)
    },
    [assistant.topics, moveTopic, setActiveTopic]
  )

  const onSwitchTopic = useCallback(
    async (topic: Topic) => {
      await modelGenerating()
      setActiveTopic(topic)
    },
    [setActiveTopic]
  )

  const onClearMessages = useCallback(() => {
    window.keyv.set(EVENT_NAMES.CHAT_COMPLETION_PAUSED, true)
    store.dispatch(setGenerating(false))
    EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES)
  }, [])

  const getTopicMenuItems = useCallback(
    (topic: Topic) => {
      const menus: MenuProps['items'] = [
        {
          label: t('chat.topics.auto_rename'),
          key: 'auto-rename',
          icon: <i className="iconfont icon-business-smart-assistant" style={{ fontSize: '14px' }} />,
          async onClick() {
            const messages = await TopicManager.getTopicMessages(topic.id)
            if (messages.length >= 2) {
              const summaryText = await fetchMessagesSummary({ messages, assistant })
              if (summaryText) {
                updateTopic({ ...topic, name: summaryText })
              }
            }
          }
        },
        {
          label: t('chat.topics.edit.title'),
          key: 'rename',
          icon: <EditOutlined />,
          async onClick() {
            const name = await PromptPopup.show({
              title: t('chat.topics.edit.title'),
              message: '',
              defaultValue: topic?.name || ''
            })
            if (name && topic?.name !== name) {
              updateTopic({ ...topic, name })
            }
          }
        },
        {
          label: t('chat.topics.clear.title'),
          key: 'clear-messages',
          icon: <ClearOutlined />,
          async onClick() {
            window.modal.confirm({
              title: t('chat.input.clear.content'),
              centered: true,
              onOk: onClearMessages
            })
          }
        },
        {
          label: t('chat.topics.export.title'),
          key: 'export',
          icon: <UploadOutlined />,
          children: [
            {
              label: t('chat.topics.export.image'),
              key: 'image',
              onClick: () => EventEmitter.emit(EVENT_NAMES.EXPORT_TOPIC_IMAGE, topic)
            },
            {
              label: t('chat.topics.export.md'),
              key: 'markdown',
              onClick: () => exportTopicAsMarkdown(topic)
            },
            {
              label: t('chat.topics.export.word'),
              key: 'word',
              onClick: async () => {
                const markdown = await topicToMarkdown(topic)
                window.api.export.toWord(markdown, topic.name)
              }
            }
          ]
        }
      ]

      if (assistants.length > 1 && assistant.topics.length > 1) {
        menus.push({
          label: t('chat.topics.move_to'),
          key: 'move',
          icon: <FolderOutlined />,
          children: assistants
            .filter((a) => a.id !== assistant.id)
            .map((a) => ({
              label: a.name,
              key: a.id,
              onClick: () => onMoveTopic(topic, a)
            }))
        })
      }

      if (assistant.topics.length > 1) {
        menus.push({ type: 'divider' })
        menus.push({
          label: t('common.delete'),
          danger: true,
          key: 'delete',
          icon: <DeleteOutlined />,
          onClick: () => onDeleteTopic(topic)
        })
      }

      return menus
    },
    [assistant, assistants, onClearMessages, onDeleteTopic, onMoveTopic, t, updateTopic]
  )

  const onDragEnd = (result: any) => {
    setIsDragging(false)
    if (!result.destination) return

    const newTopics = [...assistant.topics]
    const [removed] = newTopics.splice(result.source.index, 1)
    newTopics.splice(result.destination.index, 0, removed)
    updateTopics(newTopics)
  }

  // 创建一个内部组件来处理虚拟列表的渲染
  const VirtualList = ({ children, ...props }: any) => {
    const outerRef = useCallback((node: any) => {
      if (node !== null) {
        // 将 Droppable 的 ref 传递给外部容器
        props.provided.innerRef(node)
      }
    }, [props.provided])

    return (
      <div {...props.provided.droppableProps} ref={outerRef} style={{ height: '100%' }}>
        <List
          height={window.innerHeight - 100}
          width="100%"
          itemCount={assistant.topics.length}
          itemSize={45}
          outerElementType={(props) => <div {...props} style={{ ...props.style, overflow: 'auto' }} />}>
          {children}
        </List>
        {props.provided.placeholder}
      </div>
    )
  }

  const renderRow = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const topic = assistant.topics[index]
    const isActive = topic.id === activeTopic?.id

    return (
      <Draggable draggableId={topic.id} index={index} key={topic.id}>
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            style={{
              ...style,
              ...provided.draggableProps.style,
              padding: '0 4px'
            }}>
            <Dropdown menu={{ items: getTopicMenuItems(topic) }} trigger={['contextMenu']}>
              <TopicListItem
                className={isActive ? 'active' : ''}
                onClick={() => onSwitchTopic(topic)}
                style={{ borderRadius }}>
                <TopicName className="name">{topic.name.replace('`', '')}</TopicName>
                {showTopicTime && (
                  <TopicTime className="time">{dayjs(topic.createdAt).format('MM/DD HH:mm')}</TopicTime>
                )}
                {isActive && (
                  <MenuButton
                    className="menu"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (assistant.topics.length === 1) {
                        return onClearMessages()
                      }
                      onDeleteTopic(topic)
                    }}>
                    <CloseOutlined />
                  </MenuButton>
                )}
              </TopicListItem>
            </Dropdown>
          </div>
        )}
      </Draggable>
    )
  }

  return (
    <Container right={topicPosition === 'right'} className="topics-tab" style={{ overflow: 'hidden' }}>
      <DragDropContext
        onDragStart={() => setIsDragging(true)}
        onDragEnd={onDragEnd}>
        <Droppable
          droppableId="topics-list"
          mode="virtual"
          renderClone={(provided, snapshot, rubric) => {
            const topic = assistant.topics[rubric.source.index]
            return (
              <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                style={{
                  ...provided.draggableProps.style,
                  padding: '0 4px'
                }}>
                <TopicListItem style={{ borderRadius }}>
                  <TopicName>{topic.name.replace('`', '')}</TopicName>
                  {showTopicTime && (
                    <TopicTime>{dayjs(topic.createdAt).format('MM/DD HH:mm')}</TopicTime>
                  )}
                </TopicListItem>
              </div>
            )
          }}>
          {(provided) => <VirtualList provided={provided}>{renderRow}</VirtualList>}
        </Droppable>
      </DragDropContext>
    </Container>
  )
}

const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  padding-top: 11px;
  user-select: none;
`

const TopicListItem = styled.div`
  padding: 7px 12px;
  margin-left: 10px;
  margin-right: 4px;
  border-radius: var(--list-item-border-radius);
  font-family: Ubuntu;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: relative;
  font-family: Ubuntu;
  cursor: pointer;
  border: 0.5px solid transparent;
  .menu {
    opacity: 0;
    color: var(--color-text-3);
  }
  &:hover {
    background-color: var(--color-background-soft);
    .name {
    }
  }
  &.active {
    background-color: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
    .name {
    }
    .menu {
      opacity: 1;
      background-color: var(--color-background-soft);
      &:hover {
        color: var(--color-text-2);
      }
    }
  }
`

const TopicName = styled.div`
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
`

const TopicTime = styled.div`
  color: var(--color-text-3);
  font-size: 11px;
`

const MenuButton = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  min-width: 22px;
  min-height: 22px;
  position: absolute;
  right: 8px;
  top: 6px;
  .anticon {
    font-size: 12px;
  }
`

export default Topics
