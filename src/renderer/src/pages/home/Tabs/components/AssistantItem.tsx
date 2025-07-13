import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  SaveOutlined,
  SmileOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined
} from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import EmojiIcon from '@renderer/components/EmojiIcon'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { useAssistant, useAssistants } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTags } from '@renderer/hooks/useTags'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { getDefaultModel, getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Assistant, AssistantsSortType } from '@renderer/types'
import { getLeadingEmoji, uuid } from '@renderer/utils'
import { hasTopicPendingRequests } from '@renderer/utils/queue'
import { Dropdown, MenuProps } from 'antd'
import { omit } from 'lodash'
import { AlignJustify, Plus, Settings2, Tag, Tags } from 'lucide-react'
import { FC, memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import * as tinyPinyin from 'tiny-pinyin'

import AssistantTagsPopup from './AssistantTagsPopup'

interface AssistantItemProps {
  assistant: Assistant
  isActive: boolean
  sortBy: AssistantsSortType
  onSwitch: (assistant: Assistant) => void
  onDelete: (assistant: Assistant) => void
  onCreateDefaultAssistant: () => void
  addAgent: (agent: any) => void
  addAssistant: (assistant: Assistant) => void
  onTagClick?: (tag: string) => void
  handleSortByChange?: (sortType: AssistantsSortType) => void
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
  const { removeAllTopics } = useAssistant(assistant.id)
  const { clickAssistantToShowTopic, topicPosition, assistantIconType, setAssistantIconType } = useSettings()
  const defaultModel = getDefaultModel()
  const { assistants, updateAssistants } = useAssistants()

  const [isPending, setIsPending] = useState(false)

  useEffect(() => {
    if (isActive) {
      setIsPending(false)
      return
    }

    const hasPending = assistant.topics.some((topic) => hasTopicPendingRequests(topic.id))
    setIsPending(hasPending)
  }, [isActive, assistant.topics])

  const sortByPinyinAsc = useCallback(() => {
    updateAssistants(sortAssistantsByPinyin(assistants, true))
  }, [assistants, updateAssistants])

  const sortByPinyinDesc = useCallback(() => {
    updateAssistants(sortAssistantsByPinyin(assistants, false))
  }, [assistants, updateAssistants])

  const menuItems = useMemo(
    () =>
      getMenuItems({
        assistant,
        t,
        allTags,
        assistants,
        updateAssistants,
        addAgent,
        addAssistant,
        onSwitch,
        onDelete,
        removeAllTopics,
        setAssistantIconType,
        sortBy,
        handleSortByChange,
        sortByPinyinAsc,
        sortByPinyinDesc
      }),
    [
      assistant,
      t,
      allTags,
      assistants,
      updateAssistants,
      addAgent,
      addAssistant,
      onSwitch,
      onDelete,
      removeAllTopics,
      setAssistantIconType,
      sortBy,
      handleSortByChange,
      sortByPinyinAsc,
      sortByPinyinDesc
    ]
  )

  const handleSwitch = useCallback(async () => {
    if (clickAssistantToShowTopic) {
      if (topicPosition === 'left') {
        EventEmitter.emit(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR)
      }
    }
    onSwitch(assistant)
  }, [clickAssistantToShowTopic, onSwitch, assistant, topicPosition])

  const assistantName = useMemo(() => assistant.name || t('chat.default.name'), [assistant.name, t])
  const fullAssistantName = useMemo(
    () => (assistant.emoji ? `${assistant.emoji} ${assistantName}` : assistantName),
    [assistant.emoji, assistantName]
  )

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
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
                emoji={assistant.emoji || getLeadingEmoji(assistantName)}
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

// 提取排序相关的工具函数
const sortAssistantsByPinyin = (assistants: Assistant[], isAscending: boolean) => {
  return [...assistants].sort((a, b) => {
    const pinyinA = tinyPinyin.convertToPinyin(a.name, '', true)
    const pinyinB = tinyPinyin.convertToPinyin(b.name, '', true)
    return isAscending ? pinyinA.localeCompare(pinyinB) : pinyinB.localeCompare(pinyinA)
  })
}

// 提取标签相关的操作函数
const handleTagOperation = (
  tag: string,
  assistant: Assistant,
  assistants: Assistant[],
  updateAssistants: (assistants: Assistant[]) => void
) => {
  const removeTag = () => updateAssistants(assistants.map((a) => (a.id === assistant.id ? { ...a, tags: [] } : a)))
  const addTag = () => updateAssistants(assistants.map((a) => (a.id === assistant.id ? { ...a, tags: [tag] } : a)))
  const hasTag = assistant.tags?.includes(tag)
  hasTag ? removeTag() : addTag()
}

// 提取创建菜单项的函数
const createTagMenuItems = (
  allTags: string[],
  assistant: Assistant,
  assistants: Assistant[],
  updateAssistants: (assistants: Assistant[]) => void,
  t: (key: string) => string
): MenuProps['items'] => {
  const items: MenuProps['items'] = [
    ...allTags.map((tag) => ({
      label: tag,
      icon: assistant.tags?.includes(tag) ? <CheckOutlined size={14} /> : <Tag size={12} />,
      key: `all-tag-${tag}`,
      onClick: () => handleTagOperation(tag, assistant, assistants, updateAssistants)
    }))
  ]

  if (allTags.length > 0) {
    items.push({ type: 'divider' })
  }

  items.push({
    label: t('assistants.tags.add'),
    key: 'new-tag',
    icon: <Plus size={16} />,
    onClick: async () => {
      const tagName = await PromptPopup.show({
        title: t('assistants.tags.add'),
        message: ''
      })

      if (tagName && tagName.trim()) {
        updateAssistants(assistants.map((a) => (a.id === assistant.id ? { ...a, tags: [tagName.trim()] } : a)))
      }
    }
  })

  if (allTags.length > 0) {
    items.push({
      label: t('assistants.tags.manage'),
      key: 'manage-tags',
      icon: <Settings2 size={16} />,
      onClick: () => {
        AssistantTagsPopup.show({ title: t('assistants.tags.manage') })
      }
    })
  }

  return items
}

// 提取创建菜单配置的函数
function getMenuItems({
  assistant,
  t,
  allTags,
  assistants,
  updateAssistants,
  addAgent,
  addAssistant,
  onSwitch,
  onDelete,
  removeAllTopics,
  setAssistantIconType,
  sortBy,
  handleSortByChange,
  sortByPinyinAsc,
  sortByPinyinDesc
}): MenuProps['items'] {
  return [
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
          onOk: removeAllTopics
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
    {
      type: 'divider'
    },
    {
      label: t('assistants.tags.manage'),
      key: 'all-tags',
      icon: <PlusOutlined />,
      children: createTagMenuItems(allTags, assistant, assistants, updateAssistants, t)
    },
    {
      label: sortBy === 'list' ? t('assistants.list.showByTags') : t('assistants.list.showByList'),
      key: 'switch-view',
      icon: sortBy === 'list' ? <Tags size={14} /> : <AlignJustify size={14} />,
      onClick: () => {
        sortBy === 'list' ? handleSortByChange?.('tags') : handleSortByChange?.('list')
      }
    },
    {
      label: t('common.sort.pinyin.asc'),
      key: 'sort-asc',
      icon: <SortAscendingOutlined />,
      onClick: sortByPinyinAsc
    },
    {
      label: t('common.sort.pinyin.desc'),
      key: 'sort-desc',
      icon: <SortDescendingOutlined />,
      onClick: sortByPinyinDesc
    },
    {
      type: 'divider'
    },
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
  ]
}

const Container = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 0 8px;
  height: 37px;
  position: relative;
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid transparent;
  width: calc(var(--assistants-width) - 20px);
  cursor: pointer;
  &:hover {
    background-color: var(--color-list-item-hover);
  }
  &.active {
    background-color: var(--color-list-item);
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

export default memo(AssistantItem)
