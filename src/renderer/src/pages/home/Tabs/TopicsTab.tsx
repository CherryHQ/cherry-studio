import {
  ClearOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  PushpinOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  UploadOutlined
} from '@ant-design/icons'
import DragableList from '@renderer/components/DragableList'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { useActiveTopicContext } from '@renderer/context/ActiveTopicContext'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { TopicManager, useTopics } from '@renderer/hooks/useTopic'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
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
import { FC, startTransition, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  selectedAssistant: Assistant | null // 为了保持旧的 UI 习惯
}

const Topics: FC<Props> = ({ assistant, selectedAssistant }) => {
  const { activeTopic, setActiveTopic } = useActiveTopicContext()
  const { assistants } = useAssistants()
  const { topics, removeTopic, switchAssistant, updateTopic, updateTopics } = useTopics()
  const { t } = useTranslation()
  const { showTopicTime, topicPosition } = useSettings()

  const borderRadius = showTopicTime ? 12 : 'var(--list-item-border-radius)'

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

  const handleShowDeleteClick = useCallback((topicId: string, e: React.MouseEvent) => {
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

  const onDeleteTopic = useCallback(
    async (topic: Topic) => {
      await modelGenerating()
      removeTopic(topic)
    },
    [removeTopic]
  )

  const handleDeleteAfterShown = useCallback(
    async (topic: Topic, e: React.MouseEvent) => {
      e.stopPropagation()
      if (topics.length === 1) {
        return onClearMessages(topic)
      }
      onDeleteTopic(topic)
      setDeletingTopicId(null)
    },
    [topics, onClearMessages, onDeleteTopic]
  )

  const onPinTopic = useCallback(
    (topic: Topic) => {
      const updatedTopic = { ...topic, pinned: !topic.pinned }
      updateTopic(updatedTopic)
    },
    [updateTopic]
  )

  const onSwitchAssistant = useCallback(
    async (topic: Topic, toAssistant: Assistant) => {
      await modelGenerating()
      switchAssistant(topic, toAssistant)
    },
    [switchAssistant]
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

  const exportMenuOptions = useSelector(
    (state: RootState) =>
      state.settings.exportMenuOptions || {
        image: true,
        markdown: true,
        markdown_reason: true,
        notion: true,
        yuque: true,
        joplin: true,
        obsidian: true,
        siyuan: true,
        docx: true
      }
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
              const summaryText = await fetchMessagesSummary({
                messages,
                assistant: selectedAssistant || assistant
              })
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
            prompt !== null && updateTopic({ ...topic, prompt: prompt.trim() })
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
            exportMenuOptions.image !== false && {
              label: t('chat.topics.export.image'),
              key: 'image',
              onClick: () => EventEmitter.emit(EVENT_NAMES.EXPORT_TOPIC_IMAGE, topic)
            },
            exportMenuOptions.markdown !== false && {
              label: t('chat.topics.export.md'),
              key: 'markdown',
              onClick: () => exportTopicAsMarkdown(topic)
            },
            exportMenuOptions.markdown_reason !== false && {
              label: t('chat.topics.export.md.reason'),
              key: 'markdown_reason',
              onClick: () => exportTopicAsMarkdown(topic, true)
            },
            exportMenuOptions.docx !== false && {
              label: t('chat.topics.export.word'),
              key: 'word',
              onClick: async () => {
                const markdown = await topicToMarkdown(topic)
                window.api.export.toWord(markdown, removeSpecialCharactersForFileName(topic.name))
              }
            },
            exportMenuOptions.notion !== false && {
              label: t('chat.topics.export.notion'),
              key: 'notion',
              onClick: async () => {
                exportTopicToNotion(topic)
              }
            },
            exportMenuOptions.yuque !== false && {
              label: t('chat.topics.export.yuque'),
              key: 'yuque',
              onClick: async () => {
                const markdown = await topicToMarkdown(topic)
                exportMarkdownToYuque(topic.name, markdown)
              }
            },
            exportMenuOptions.obsidian !== false && {
              label: t('chat.topics.export.obsidian'),
              key: 'obsidian',
              onClick: async () => {
                const markdown = await topicToMarkdown(topic)
                await ObsidianExportPopup.show({ title: topic.name, markdown, processingMethod: '3' })
              }
            },
            exportMenuOptions.joplin !== false && {
              label: t('chat.topics.export.joplin'),
              key: 'joplin',
              onClick: async () => {
                const markdown = await topicToMarkdown(topic)
                exportMarkdownToJoplin(topic.name, markdown)
              }
            },
            exportMenuOptions.siyuan !== false && {
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

      // 切换助手：助手可以没有话题，所以不需要检查助手关联的话题数量
      if (assistants.length > 1) {
        menus.push({
          label: t('chat.topics.switch_assistant'),
          key: 'switch-assistant',
          icon: <RobotOutlined />,
          children: assistants.map((a) => ({
            label: a.name,
            key: a.id,
            disabled: a.id === topic.assistantId,
            onClick: () => onSwitchAssistant(topic, a)
          }))
        })
      }

      if (topics.length > 1 && !topic.pinned) {
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
    [
      assistant,
      assistants,
      exportMenuOptions.docx,
      exportMenuOptions.image,
      exportMenuOptions.joplin,
      exportMenuOptions.markdown,
      exportMenuOptions.markdown_reason,
      exportMenuOptions.notion,
      exportMenuOptions.obsidian,
      exportMenuOptions.siyuan,
      exportMenuOptions.yuque,
      onClearMessages,
      onDeleteTopic,
      onPinTopic,
      onSwitchAssistant,
      selectedAssistant,
      t,
      topics.length,
      updateTopic
    ]
  )

  const displayTopics = useMemo(() => {
    if (selectedAssistant) {
      return topics.filter((topic) => topic.assistantId === selectedAssistant.id)
    }
    return topics
  }, [topics, selectedAssistant])

  const handleTopicsUpdate = useCallback(
    (updatedTopics: Topic[]) => {
      if (selectedAssistant) {
        const otherTopics = topics.filter((topic) => topic.assistantId !== selectedAssistant.id)
        updateTopics([...updatedTopics, ...otherTopics])
      } else {
        updateTopics(updatedTopics)
      }
    },
    [selectedAssistant, topics, updateTopics]
  )

  return (
    <Container right={topicPosition === 'right'} className="topics-tab">
      <DragableList list={displayTopics} onUpdate={handleTopicsUpdate}>
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
                          handleDeleteAfterShown(topic, e)
                        } else if (deletingTopicId === topic.id) {
                          handleDeleteAfterShown(topic, e)
                        } else {
                          handleShowDeleteClick(topic.id, e)
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
      </DragableList>{' '}
      <div style={{ minHeight: '10px' }}></div>
    </Container>
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
