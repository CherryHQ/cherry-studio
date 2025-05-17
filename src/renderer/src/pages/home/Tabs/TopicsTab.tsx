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
import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { useAssistant, useAssistants } from '@renderer/hooks/useAssistant'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { TopicManager } from '@renderer/hooks/useTopic'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import store from '@renderer/store'
import { RootState } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import { Assistant, Topic } from '@renderer/types'
import { removeSpecialCharactersForFileName } from '@renderer/utils'
import { copyTopicAsMarkdown } from '@renderer/utils/copy'
import {
  exportMarkdownToJoplin,
  exportMarkdownToSiyuan,
  exportMarkdownToYuque,
  exportTopicAsMarkdown,
  exportTopicToNotion,
  topicToMarkdown
} from '@renderer/utils/export'
import { hasTopicPendingRequests } from '@renderer/utils/queue'
import { Dropdown, MenuProps, Tooltip } from 'antd'
import { ItemType, MenuItemType } from 'antd/es/menu/interface'
import dayjs from 'dayjs'
import { findIndex } from 'lodash'
import { FC, startTransition, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
}

const Topics: FC<Props> = ({ assistant: _assistant, activeTopic, setActiveTopic }) => {
  const { assistants } = useAssistants()
  const { assistant, removeTopic, moveTopic, updateTopic, updateTopics, addTopic } = useAssistant(_assistant.id)
  const { t } = useTranslation()
  const { showTopicTime, topicPosition } = useSettings()

  const borderRadius = showTopicTime ? 12 : 'var(--list-item-border-radius)'

  const [selectedTopics, setSelectedTopics] = useState<Topic[]>([])
  const [isMultiSelect, setIsMultiSelect] = useState(false)
  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null)
  const deleteTimerRef = useRef<NodeJS.Timeout>(null)

  const pendingTopics = useMemo(() => {
    return new Set<string>()
  }, [])
  const isPending = useCallback(
    (topicId: string) => {
      const hasPending = hasTopicPendingRequests(topicId)
      if (topicId === activeTopic.id && !hasPending) {
        pendingTopics.delete(topicId)
        return false
      }
      if (pendingTopics.has(topicId)) {
        return true
      }
      if (hasPending) {
        pendingTopics.add(topicId)
        return true
      }
      return false
    },
    [activeTopic.id, pendingTopics]
  )

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

  const onDeleteSelectedTopics = useCallback(async () => {
    if (selectedTopics.length === 0) return

    const originalTopicCount = assistant.topics.length

    // If active topic is in selection, switch to next available topic
    const activeIndex = findIndex(assistant.topics, (t) => t.id === activeTopic?.id)
    if (activeIndex !== -1) {
      const nextIndex = activeIndex + 1 < assistant.topics.length ? activeIndex + 1 : activeIndex - 1
      if (nextIndex >= 0) {
        setActiveTopic(assistant.topics[nextIndex])
      }
    }

    // Remove all selected topics
    selectedTopics.forEach((topic) => removeTopic(topic))
    setSelectedTopics([])

    // Auto-create new topic if all were deleted or active topic was deleted
    if (selectedTopics.length === originalTopicCount) {
      const newTopic = getDefaultTopic(assistant.id)
      addTopic(newTopic)
      setActiveTopic(newTopic)
    }
  }, [assistant.topics, activeTopic, selectedTopics, removeTopic, setActiveTopic, addTopic, assistant.id])

  const onMoveSelectedTopics = useCallback(
    async (toAssistant: Assistant) => {
      if (selectedTopics.length === 0) return

      const originalTopicCount = assistant.topics.length

      // If active topic is in selection, switch to next available topic
      const activeIndex = findIndex(assistant.topics, (t) => t.id === activeTopic?.id)
      if (activeIndex !== -1) {
        const nextIndex = activeIndex + 1 < assistant.topics.length ? activeIndex + 1 : activeIndex - 1
        if (nextIndex >= 0) {
          setActiveTopic(assistant.topics[nextIndex])
        }
      }

      // Move each selected topic to target assistant
      selectedTopics.forEach((topic) => moveTopic(topic, toAssistant))

      // Clear selection after move
      setSelectedTopics([])

      // Auto-create new topic if all were deleted or active topic was deleted
      if (selectedTopics.length === originalTopicCount) {
        const newTopic = getDefaultTopic(assistant.id)
        addTopic(newTopic)
        setActiveTopic(newTopic)
      }
    },
    [selectedTopics, assistant.topics, assistant.id, activeTopic?.id, setActiveTopic, moveTopic, addTopic]
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
      if (topic.id === activeTopic?.id) {
        const index = findIndex(assistant.topics, (t) => t.id === topic.id)
        setActiveTopic(assistant.topics[index + 1 === assistant.topics.length ? index - 1 : index + 1])
      }
      removeTopic(topic)
    },
    [assistant.topics, removeTopic, setActiveTopic, activeTopic]
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
      startTransition(() => {
        setActiveTopic(topic)
      })
    },
    [setActiveTopic]
  )

  const exportMenuOptions = useSelector((state: RootState) => state.settings.exportMenuOptions)

  const [_targetTopic, setTargetTopic] = useState<Topic | null>(null)
  const targetTopic = useDeferredValue(_targetTopic)
  const getTopicMenuItems = useMemo(() => {
    const topic = targetTopic
    if (!topic) return []

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
              updateTopic({ ...topic, name: summaryText, isNameManuallyEdited: false })
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
            updateTopic({ ...topic, name, isNameManuallyEdited: true })
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

          prompt !== null &&
            (() => {
              const updatedTopic = { ...topic, prompt: prompt.trim() }
              updateTopic(updatedTopic)
              topic.id === activeTopic.id && setActiveTopic(updatedTopic)
            })()
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
          exportMenuOptions.image && {
            label: t('chat.topics.export.image'),
            key: 'image',
            onClick: () => EventEmitter.emit(EVENT_NAMES.EXPORT_TOPIC_IMAGE, topic)
          },
          exportMenuOptions.markdown && {
            label: t('chat.topics.export.md'),
            key: 'markdown',
            onClick: () => exportTopicAsMarkdown(topic)
          },
          exportMenuOptions.markdown_reason && {
            label: t('chat.topics.export.md.reason'),
            key: 'markdown_reason',
            onClick: () => exportTopicAsMarkdown(topic, true)
          },
          exportMenuOptions.docx && {
            label: t('chat.topics.export.word'),
            key: 'word',
            onClick: async () => {
              const markdown = await topicToMarkdown(topic)
              window.api.export.toWord(markdown, removeSpecialCharactersForFileName(topic.name))
            }
          },
          exportMenuOptions.notion && {
            label: t('chat.topics.export.notion'),
            key: 'notion',
            onClick: async () => {
              exportTopicToNotion(topic)
            }
          },
          exportMenuOptions.yuque && {
            label: t('chat.topics.export.yuque'),
            key: 'yuque',
            onClick: async () => {
              const markdown = await topicToMarkdown(topic)
              exportMarkdownToYuque(topic.name, markdown)
            }
          },
          exportMenuOptions.obsidian && {
            label: t('chat.topics.export.obsidian'),
            key: 'obsidian',
            onClick: async () => {
              const markdown = await topicToMarkdown(topic)
              await ObsidianExportPopup.show({ title: topic.name, markdown, processingMethod: '3' })
            }
          },
          exportMenuOptions.joplin && {
            label: t('chat.topics.export.joplin'),
            key: 'joplin',
            onClick: async () => {
              const markdown = await topicToMarkdown(topic)
              exportMarkdownToJoplin(topic.name, markdown)
            }
          },
          exportMenuOptions.siyuan && {
            label: t('chat.topics.export.siyuan'),
            key: 'siyuan',
            onClick: async () => {
              const markdown = await topicToMarkdown(topic)
              exportMarkdownToSiyuan(topic.name, markdown)
            }
          }
        ].filter(Boolean) as ItemType<MenuItemType>[]
      }
    ]

    // Add batch operations to context menu when in multi-select mode
    if (isMultiSelect && selectedTopics.length > 0) {
      menus.push({ type: 'divider' })
      menus.push({
        label: t('chat.topics.delete.selected', { count: selectedTopics.length }),
        key: 'batch-delete',
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () => {
          onDeleteSelectedTopics()
        }
      })

      if (assistants.length > 1) {
        menus.push({
          label: t('chat.topics.move_to'),
          key: 'batch-move',
          icon: <FolderOutlined />,
          children: assistants
            .filter((a) => a.id !== assistant.id)
            .map((a) => ({
              label: a.name,
              key: a.id,
              onClick: () => onMoveSelectedTopics(a)
            }))
        })
      }
    }

    // Original move option (single topic) - only show when not in multi-select mode
    if (!isMultiSelect && assistants.length > 1 && assistant.topics.length > 1) {
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
  }, [
    targetTopic,
    t,
    exportMenuOptions.image,
    exportMenuOptions.markdown,
    exportMenuOptions.markdown_reason,
    exportMenuOptions.docx,
    exportMenuOptions.notion,
    exportMenuOptions.yuque,
    exportMenuOptions.obsidian,
    exportMenuOptions.joplin,
    exportMenuOptions.siyuan,
    isMultiSelect,
    selectedTopics.length,
    assistants,
    assistant,
    updateTopic,
    activeTopic.id,
    setActiveTopic,
    onPinTopic,
    onClearMessages,
    onDeleteSelectedTopics,
    onMoveSelectedTopics,
    onMoveTopic,
    onDeleteTopic
  ])

  return (
    <Dropdown menu={{ items: getTopicMenuItems }} trigger={['contextMenu']}>
      <Container right={topicPosition === 'right'} className="topics-tab">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
          <Tooltip title={t('chat.topics.multi_select.hint', { key: 'shift' })} placement="bottom">
            <button
              type="button"
              onClick={() => {
                const newIsMultiSelect = !isMultiSelect
                setIsMultiSelect(newIsMultiSelect)
                if (!newIsMultiSelect) {
                  setSelectedTopics([])
                }
              }}
              style={{
                background: isMultiSelect ? 'var(--color-primary)' : 'transparent',
                color: isMultiSelect ? 'white' : 'var(--color-text-2)',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '12px',
                cursor: 'pointer'
              }}>
              {isMultiSelect ? t('chat.topics.exit_multi_select') : t('chat.topics.enter_multi_select')}
            </button>
          </Tooltip>
        </div>
        <DragableList list={assistant.topics} onUpdate={updateTopics}>
          {(topic) => {
            const isActive = topic.id === activeTopic?.id
            const topicName = topic.name.replace('`', '')
            const topicPrompt = topic.prompt
            const fullTopicPrompt = t('common.prompt') + ': ' + topicPrompt
            return (
              <TopicListItem
                onContextMenu={() => setTargetTopic(topic)}
                className={`${isActive ? 'active' : ''} ${
                  selectedTopics.some((t) => t.id === topic.id) ? 'selected' : ''
                }`}
                onClick={(e) => {
                  if (isMultiSelect) {
                    if (e.shiftKey) {
                      // Range selection logic
                      setSelectedTopics((prev) => {
                        const currentIndex = assistant.topics.findIndex((t) => t.id === topic.id)
                        const lastSelectedIndex =
                          prev.length > 0 ? assistant.topics.findIndex((t) => t.id === prev[0].id) : -1

                        if (lastSelectedIndex === -1) {
                          return [topic]
                        }

                        const start = Math.min(lastSelectedIndex, currentIndex)
                        const end = Math.max(lastSelectedIndex, currentIndex)

                        return assistant.topics.slice(start, end + 1)
                      })
                    } else {
                      // Toggle individual selection
                      setSelectedTopics((prev) =>
                        prev.some((t) => t.id === topic.id) ? prev.filter((t) => t.id !== topic.id) : [...prev, topic]
                      )
                    }
                  } else {
                    onSwitchTopic(topic)
                  }
                }}
                style={{ borderRadius }}>
                {isPending(topic.id) && !isActive && <PendingIndicator />}
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
            )
          }}
        </DragableList>
        <div style={{ minHeight: '10px' }}></div>
      </Container>
    </Dropdown>
  )
}

const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  padding: 10px;
`

const TopicListItem = styled.div`
  padding: 7px 12px;
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
  position: relative;
  width: calc(var(--assistants-width) - 20px);
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
      &:hover {
        color: var(--color-text-2);
      }
    }
  }
  &.selected {
    background-color: var(--color-background-selected);
    border: 0.5px solid var(--color-primary);
  }
`

const TopicName = styled.div`
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
`

const PendingIndicator = styled.div.attrs({
  className: 'animation-pulse'
})`
  --pulse-size: 5px;
  width: 5px;
  height: 5px;
  position: absolute;
  left: 3px;
  top: 15px;
  border-radius: 50%;
  background-color: var(--color-primary);
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
