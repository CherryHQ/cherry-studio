import {
  ClearOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOutlined,
  PushpinOutlined,
  QuestionCircleOutlined,
  UploadOutlined
} from '@ant-design/icons'
import DragableList from '@renderer/components/DragableList'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { useAssistant, useAssistants } from '@renderer/hooks/useAssistant'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { TopicManager } from '@renderer/hooks/useTopic'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import store from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import { Assistant, Topic } from '@renderer/types'
import { removeSpecialCharactersForFileName } from '@renderer/utils'
import { copyTopicAsMarkdown } from '@renderer/utils/copy'
import {
  exportMarkdownToNotion,
  exportMarkdownToYuque,
  exportTopicAsMarkdown,
  topicToMarkdown
} from '@renderer/utils/export'
import { Dropdown, MenuProps, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { findIndex } from 'lodash'
import { FC, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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

  const borderRadius = showTopicTime ? 12 : 'var(--list-item-border-radius)'

  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null)
  const deleteTimerRef = useRef<NodeJS.Timeout>()

  const handleDeleteClick = useCallback((topicId: string, e: React.MouseEvent) => {
    e.stopPropagation()

    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current)
    }

    setDeletingTopicId(topicId)

    deleteTimerRef.current = setTimeout(() => setDeletingTopicId(null), 2000)
  }, [])

  const onClearMessages = useCallback((topic: Topic) => {
    // window.keyv.set(EVENT_NAMES.CHAT_COMPLETION_PAUSED, true)
    store.dispatch(setGenerating(false))
    EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
  }, [])

  const handleConfirmDelete = useCallback(
    async (topic: Topic, e: React.MouseEvent) => {
      e.stopPropagation()
      if (assistant.topics.length === 1) {
        return onClearMessages(topic)
      }
      await modelGenerating()
      const index = findIndex(assistant.topics, (t) => t.id === topic.id)
      setActiveTopic(assistant.topics[index + 1 === assistant.topics.length ? index - 1 : index + 1])
      removeTopic(topic)
      setDeletingTopicId(null)
    },
    [assistant.topics, onClearMessages, removeTopic, setActiveTopic]
  )

  const onPinTopic = useCallback(
    (topic: Topic) => {
      const updatedTopic = { ...topic, pinned: !topic.pinned }
      updateTopic(updatedTopic)
    },
    [updateTopic]
  )

  const onDeleteTopic = useCallback(
    async (topic: Topic) => {
      await modelGenerating()
      const index = findIndex(assistant.topics, (t) => t.id === topic.id)
      setActiveTopic(assistant.topics[index + 1 === assistant.topics.length ? index - 1 : index + 1])
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
      // await modelGenerating()
      setActiveTopic(topic)
    },
    [setActiveTopic]
  )

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
          label: t('chat.topics.prompt'),
          key: 'topic-prompt',
          icon: <i className="iconfont icon-ai-model1" style={{ fontSize: '14px' }} />,
          extra: (
            <Tooltip title={t('chat.topics.prompt.tips')}>
              <QuestionIcon />
            </Tooltip>
          ),
          async onClick() {
            const prompt = await PromptPopup.show({
              title: t('chat.topics.prompt.edit.title'),
              message: '',
              defaultValue: topic?.prompt || '',
              inputProps: {
                rows: 8,
                allowClear: true
              }
            })
            prompt && updateTopic({ ...topic, prompt: prompt.trim() })
          }
        },
        {
          label: topic.pinned ? t('chat.topics.unpinned') : t('chat.topics.pinned'),
          key: 'pin',
          icon: <PushpinOutlined />,
          onClick() {
            onPinTopic(topic)
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
              onOk: () => onClearMessages(topic)
            })
          }
        },
        {
          label: t('chat.topics.copy.title'),
          key: 'copy',
          icon: <CopyIcon />,
          children: [
            {
              label: t('chat.topics.copy.image'),
              key: 'img',
              onClick: () => EventEmitter.emit(EVENT_NAMES.COPY_TOPIC_IMAGE, topic)
            },
            {
              label: t('chat.topics.copy.md'),
              key: 'md',
              onClick: () => copyTopicAsMarkdown(topic)
            }
          ]
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
                window.api.export.toWord(markdown, removeSpecialCharactersForFileName(topic.name))
              }
            },
            {
              label: t('chat.topics.export.notion'),
              key: 'notion',
              onClick: async () => {
                const markdown = await topicToMarkdown(topic)
                exportMarkdownToNotion(topic.name, markdown)
              }
            },
            {
              label: t('chat.topics.export.yuque'),
              key: 'yuque',
              onClick: async () => {
                const markdown = await topicToMarkdown(topic)
                exportMarkdownToYuque(topic.name, markdown)
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

      if (assistant.topics.length > 1 && !topic.pinned) {
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
    [assistant, assistants, onClearMessages, onDeleteTopic, onPinTopic, onMoveTopic, t, updateTopic]
  )

  return (
    <Container right={topicPosition === 'right'} className="topics-tab">
      <DragableList list={assistant.topics} onUpdate={updateTopics}>
        {(topic) => {
          const isActive = topic.id === activeTopic?.id
          const topicName = topic.name.replace('`', '')
          const topicPrompt = topic.prompt
          const fullTopicPrompt = t('common.prompt') + ': ' + topicPrompt
          return (
            <Dropdown menu={{ items: getTopicMenuItems(topic) }} trigger={['contextMenu']} key={topic.id}>
              <TopicListItem
                className={isActive ? 'active' : ''}
                onClick={() => onSwitchTopic(topic)}
                style={{ borderRadius }}>
                <TopicName className="name" title={topicName}>
                  {topicName}
                </TopicName>
                {topicPrompt && (
                  <TopicPromptText className="prompt" title={fullTopicPrompt}>
                    {fullTopicPrompt}
                  </TopicPromptText>
                )}
                {showTopicTime && (
                  <TopicTime className="time">{dayjs(topic.createdAt).format('MM/DD HH:mm')}</TopicTime>
                )}
                <MenuButton className="pin">{topic.pinned && <PushpinOutlined />}</MenuButton>
                {isActive && !topic.pinned && (
                  <Tooltip
                    placement="bottom"
                    mouseEnterDelay={0.7}
                    title={
                      <div>
                        <div style={{ fontSize: '12px', opacity: 0.8, fontStyle: 'italic' }}>
                          {t('chat.topics.delete.shortcut', { key: isMac ? '⌘' : 'Ctrl' })}
                        </div>
                      </div>
                    }>
                    <MenuButton
                      className="menu"
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey) {
                          handleConfirmDelete(topic, e)
                        } else if (deletingTopicId === topic.id) {
                          handleConfirmDelete(topic, e)
                        } else {
                          handleDeleteClick(topic.id, e)
                        }
                      }}>
                      {deletingTopicId === topic.id ? (
                        <DeleteOutlined style={{ color: 'var(--color-error)' }} />
                      ) : (
                        <CloseOutlined />
                      )}
                    </MenuButton>
                  </Tooltip>
                )}
              </TopicListItem>
            </Dropdown>
          )
        }}
      </DragableList>
      <div style={{ minHeight: '10px' }}></div>
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

const TopicPromptText = styled.div`
  color: var(--color-text-2);
  font-size: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  ~ .prompt-text {
    margin-top: 10px;
  }
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
const QuestionIcon = styled(QuestionCircleOutlined)`
  font-size: 14px;
  cursor: pointer;
  color: var(--color-text-3);
`

export default Topics
