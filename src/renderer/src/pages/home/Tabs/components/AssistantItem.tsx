import {
  DeleteOutlined,
  EditOutlined,
  MenuOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  SaveOutlined,
  SmileOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  TagsOutlined
} from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import EmojiIcon from '@renderer/components/EmojiIcon'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import TagsPopup from '@renderer/components/Popups/TagsPopup'
import { useAssistant, useAssistants } from '@renderer/hooks/useAssistant'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTags } from '@renderer/hooks/useTags'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { getDefaultModel, getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Assistant } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { hasTopicPendingRequests } from '@renderer/utils/queue'
import { Dropdown } from 'antd'
import { ItemType } from 'antd/es/menu/interface'
import { omit } from 'lodash'
import { FC, startTransition, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import * as tinyPinyin from 'tiny-pinyin'

interface AssistantItemProps {
  assistant: Assistant
  isActive: boolean
  sortBy: 'tags' | 'list'
  onSwitch: (assistant: Assistant) => void
  onDelete: (assistant: Assistant) => void
  onCreateDefaultAssistant: () => void
  addAgent: (agent: any) => void
  addAssistant: (assistant: Assistant) => void
  onTagClick?: (tag: string) => void
  handleSortByChange?: (sortType: '' | 'tags' | 'list') => void
}

const AssistantItem: FC<AssistantItemProps> = ({
  assistant,
  isActive,
  sortBy,
  onSwitch,
  onDelete,
  addAgent,
  addAssistant,
  handleSortByChange
}) => {
  const { t } = useTranslation()
  const { allTags } = useTags()
  const { removeAllTopics } = useAssistant(assistant.id) // 使用当前助手的ID
  const { clickAssistantToShowTopic, topicPosition, assistantIconType, setAssistantIconType } = useSettings()
  const defaultModel = getDefaultModel()
  const { assistants, updateAssistants } = useAssistants()

  const [isPending, setIsPending] = useState(false)
  useEffect(() => {
    if (isActive) {
      setIsPending(false)
    }
    const hasPending = assistant.topics.some((topic) => hasTopicPendingRequests(topic.id))
    if (hasPending) {
      setIsPending(true)
    }
  }, [isActive, assistant.topics])

  const sortByPinyinAsc = useCallback(() => {
    const sorted = [...assistants].sort((a, b) => {
      const pinyinA = tinyPinyin.convertToPinyin(a.name, '', true)
      const pinyinB = tinyPinyin.convertToPinyin(b.name, '', true)
      return pinyinA.localeCompare(pinyinB)
    })
    updateAssistants(sorted)
  }, [assistants, updateAssistants])

  const sortByPinyinDesc = useCallback(() => {
    const sorted = [...assistants].sort((a, b) => {
      const pinyinA = tinyPinyin.convertToPinyin(a.name, '', true)
      const pinyinB = tinyPinyin.convertToPinyin(b.name, '', true)
      return pinyinB.localeCompare(pinyinA)
    })
    updateAssistants(sorted)
  }, [assistants, updateAssistants])

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
      {
        label: t('assistants.icon.type'),
        key: 'icon-type',
        icon: <SmileOutlined />,
        children: [
          {
            label: t('settings.assistant.icon.type.model'),
            key: 'model',
            onClick: () => setAssistantIconType('model')
          },
          {
            label: t('settings.assistant.icon.type.emoji'),
            key: 'emoji',
            onClick: () => setAssistantIconType('emoji')
          },
          {
            label: t('settings.assistant.icon.type.none'),
            key: 'none',
            onClick: () => setAssistantIconType('none')
          }
        ]
      },
      { type: 'divider' },
      {
        label: t('assistants.tags.manage'),
        key: 'all-tags',
        icon: <PlusOutlined />,
        children: [
          ...allTags.map((tag) => ({
            label: tag,
            icon: assistant.tags?.includes(tag) ? <DeleteOutlined /> : <TagsOutlined />,
            danger: assistant.tags?.includes(tag) ? true : false,
            key: `all-tag-${tag}`,
            onClick: () => {
              if (assistant.tags?.includes(tag)) {
                // 如果已有该标签，则移除
                updateAssistants(assistants.map((a) => (a.id === assistant.id ? { ...a, tags: [] } : a)))
              } else {
                // 如果没有该标签，则切换到该标签分类
                updateAssistants(assistants.map((a) => (a.id === assistant.id ? { ...a, tags: [tag] } : a)))
              }
            }
          })),
          allTags.length > 0 ? { type: 'divider' } : null,
          {
            label: t('assistants.tags.add'),
            key: 'new-tag',
            onClick: () => {
              TagsPopup.show(
                assistant,
                (updated) => {
                  updateAssistants(assistants.map((a) => (a.id === assistant.id ? updated : a)))
                },
                'add'
              )
            }
          },
          allTags.length > 0
            ? {
                label: t('assistants.tags.manage'),
                key: 'manage-tags',
                onClick: () => {
                  TagsPopup.show(
                    assistant,
                    (updated) => {
                      updateAssistants(assistants.map((a) => (a.id === assistant.id ? updated : a)))
                    },
                    'manage'
                  )
                }
              }
            : null
        ]
      },
      {
        label: sortBy === 'list' ? t('assistants.list.showByTags') : t('assistants.list.showByList'),
        key: 'switch-view',
        icon: sortBy === 'list' ? <TagsOutlined /> : <MenuOutlined />,
        onClick: () => {
          sortBy === 'list' ? handleSortByChange?.('tags') : handleSortByChange?.('list')
        }
      },
      {
        label: t('common.sort.pinyin.asc'),
        key: 'sort-asc',
        icon: <SortAscendingOutlined />,
        onClick: () => sortByPinyinAsc()
      },
      {
        label: t('common.sort.pinyin.desc'),
        key: 'sort-desc',
        icon: <SortDescendingOutlined />,
        onClick: () => sortByPinyinDesc()
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
    [
      addAgent,
      addAssistant,
      allTags,
      assistants,
      handleSortByChange,
      onDelete,
      onSwitch,
      removeAllTopics,
      setAssistantIconType,
      sortBy,
      sortByPinyinAsc,
      sortByPinyinDesc,
      t,
      updateAssistants
    ]
  )

  const handleSwitch = useCallback(async () => {
    await modelGenerating()

    if (clickAssistantToShowTopic) {
      if (topicPosition === 'left') {
        EventEmitter.emit(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR)
      }
      onSwitch(assistant)
    } else {
      startTransition(() => {
        onSwitch(assistant)
      })
    }
  }, [clickAssistantToShowTopic, onSwitch, assistant, topicPosition])

  const assistantName = assistant.name || t('chat.default.name')
  const fullAssistantName = assistant.emoji ? `${assistant.emoji} ${assistantName}` : assistantName

  return (
    <Dropdown menu={{ items: getMenuItems(assistant) }} trigger={['contextMenu']}>
      <Container onClick={handleSwitch} className={isActive ? 'active' : ''}>
        <AssistantNameRow className="name" title={fullAssistantName}>
          {assistantIconType === 'model' ? (
            <ModelAvatar
              model={assistant.model || defaultModel}
              size={24}
              className={isPending && !isActive ? 'animation-pulse' : ''}
            />
          ) : (
            assistantIconType === 'emoji' && (
              <EmojiIcon
                emoji={assistant.emoji || assistantName.slice(0, 1)}
                className={isPending && !isActive ? 'animation-pulse' : ''}
              />
            )
          )}
          <AssistantName className="text-nowrap">{assistantName}</AssistantName>
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
  padding: 0 10px;
  height: 37px;
  position: relative;
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
  gap: 8px;
`

const AssistantName = styled.div`
  font-size: 13px;
`

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
