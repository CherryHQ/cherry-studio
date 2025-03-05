import {
  ClearOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  LockOutlined,
  PlusOutlined,
  PushpinOutlined,
  QuestionCircleOutlined,
  RetweetOutlined,
  RightOutlined,
  UnlockOutlined,
  UploadOutlined
} from '@ant-design/icons'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import SparkleIcon from '@renderer/components/Icons/SparkleIcon'
// 使用本地 SparkleIcon 组件
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { useAssistant, useAssistants } from '@renderer/hooks/useAssistant'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTopicGroups } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import store from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import { Assistant, Topic, TopicGroup } from '@renderer/types'
import { copyTopicAsMarkdown } from '@renderer/utils/copy'
import {
  exportMarkdownToNotion,
  exportMarkdownToYuque,
  exportTopicAsMarkdown,
  topicToMarkdown
} from '@renderer/utils/export'
import { safeFilter, safeMap } from '@renderer/utils/safeArrayUtils'
import { Dropdown, Form, Input, MenuProps, Modal, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { findIndex } from 'lodash'
import { FC, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { v4 as uuid } from 'uuid'

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
}

const Topics: FC<Props> = ({ assistant: _assistant, activeTopic, setActiveTopic }) => {
  const { assistants } = useAssistants()
  const { assistant, removeTopic, updateTopic, addTopic, duplicateTopic } = useAssistant(_assistant.id)
  const { t } = useTranslation()
  const { showTopicTime, topicPosition } = useSettings()
  const { topicGroups, addGroup, updateGroup, removeGroup, updateTopicGroup } = useTopicGroups(_assistant.id)
  const [form] = Form.useForm()

  const borderRadius = showTopicTime ? 12 : 'var(--list-item-border-radius)'

  // 分组管理状态
  const [groupModalVisible, setGroupModalVisible] = useState(false)
  const [currentGroup, setCurrentGroup] = useState<TopicGroup | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(safeMap(topicGroups, (g) => g.id)))
  const [dragging, setDragging] = useState(false)
  const dropTargetRef = useRef<string | null>(null)

  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null)
  const deleteTimerRef = useRef<NodeJS.Timeout>()

  // 初始化分组后，按分组对话题进行分类
  const ungroupedTopics = safeFilter(assistant.topics, (topic) => !topic.groupId)

  // 分组话题
  const getGroupTopics = (groupId: string) => {
    return safeFilter(assistant.topics, (topic) => topic.groupId === groupId)
  }

  // 创建新话题
  const handleCreateTopic = () => {
    const newTopic: Topic = {
      id: uuid(),
      name: t('topics.new') || '新话题',
      assistantId: assistant.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    }
    addTopic(newTopic)
    setActiveTopic(newTopic)
  }

  // 分组管理函数
  const handleCreateGroup = () => {
    setCurrentGroup(null)
    form.resetFields()
    setGroupModalVisible(true)
  }

  const handleEditGroup = (group: TopicGroup, e: React.MouseEvent) => {
    e.stopPropagation() // 阻止事件冒泡到toggle
    setCurrentGroup(group)
    form.setFieldsValue({
      name: group.name,
      description: group.description
    })
    setGroupModalVisible(true)
  }

  const handleDeleteGroup = (groupId: string) => {
    window.modal.confirm({
      title: t('topics.group.delete.title') || '删除分组',
      content: t('topics.group.delete.content') || '确定要删除此分组吗？话题将被移动到未分组区域。',
      okButtonProps: { danger: true },
      centered: true,
      onOk: () => {
        removeGroup(groupId)
      }
    })
  }

  const handleGroupFormSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (currentGroup) {
        // 编辑现有分组
        updateGroup({
          ...currentGroup,
          name: values.name,
          description: values.description
        })
      } else {
        // 创建新分组
        const newGroup = addGroup(values.name, values.description)
        if (newGroup) {
          // 展开新创建的分组
          setExpandedGroups(new Set([...expandedGroups, newGroup.id]))
        }
      }
      setGroupModalVisible(false)
    } catch (error) {
      console.error('分组表单验证错误:', error)
    }
  }

  // 切换分组的展开/折叠状态
  const toggleGroupExpanded = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation() // 阻止事件冒泡
    if (expandedGroups.has(groupId)) {
      const newSet = new Set(expandedGroups)
      newSet.delete(groupId)
      setExpandedGroups(newSet)
    } else {
      setExpandedGroups(new Set([...expandedGroups, groupId]))
    }
  }

  // 处理将话题拖入分组
  const handleTopicDragStart = (e: React.DragEvent, topicId: string) => {
    setDragging(true)
    e.dataTransfer.setData('topicId', topicId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleTopicDragEnd = () => {
    setDragging(false)
    dropTargetRef.current = null
  }

  const handleTopicDragOver = (e: React.DragEvent, groupId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    dropTargetRef.current = groupId !== null ? groupId : null
  }

  const handleTopicDragLeave = () => {
    dropTargetRef.current = null
  }

  const handleTopicDrop = (e: React.DragEvent, groupId: string | null) => {
    e.preventDefault()
    const topicId = e.dataTransfer.getData('topicId')
    if (topicId && assistant.id) {
      updateTopicGroup(assistant.id, topicId, groupId)
    }
    setDragging(false)
    dropTargetRef.current = null
  }

  const handleDeleteClick = useCallback((topicId: string, e: React.MouseEvent) => {
    e.stopPropagation()

    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current)
    }

    setDeletingTopicId(topicId)

    deleteTimerRef.current = setTimeout(() => setDeletingTopicId(null), 2000)
  }, [])

  const onClearMessages = useCallback((topic: Topic) => {
    window.keyv.set(EVENT_NAMES.CHAT_COMPLETION_PAUSED, true)
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

  const onLockTopic = useCallback(
    (topic: Topic) => {
      const updatedTopic = { ...topic, locked: !topic.locked }
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

  const onDuplicateTopic = useCallback(
    async (topic: Topic, toAssistant: Assistant) => {
      await modelGenerating()
      duplicateTopic(topic, toAssistant)
    },
    [duplicateTopic]
  )

  const onSwitchTopic = useCallback(
    async (topic: Topic) => {
      await modelGenerating()
      setActiveTopic(topic)
    },
    [setActiveTopic]
  )

  // 主要渲染函数
  const renderTopicItem = (topic: Topic) => {
    const isActive = topic.id === activeTopic?.id
    const topicName = topic.name.replace('`', '')
    const topicPrompt = topic.prompt
    const fullTopicPrompt = t('common.prompt') + ': ' + topicPrompt

    return (
      <div
        key={topic.id}
        draggable="true"
        onDragStart={(e) => handleTopicDragStart(e, topic.id)}
        onDragEnd={handleTopicDragEnd}
        className="topic-item-wrapper">
        <Dropdown menu={{ items: getTopicMenuItems(topic) }} trigger={['contextMenu']}>
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
            {showTopicTime && <TopicTime className="time">{dayjs(topic.createdAt).format('MM/DD HH:mm')}</TopicTime>}
            <MenuButton className="pin">
              {topic.locked && <LockOutlined style={{ color: 'var(--color-warning)' }} />}
              {topic.pinned && <PushpinOutlined style={{ marginLeft: topic.locked ? '5px' : '0' }} />}
            </MenuButton>
            {isActive && !topic.pinned && !topic.locked && (
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
      </div>
    )
  }

  // 渲染分组
  const renderGroup = (group: TopicGroup) => {
    const groupTopics = getGroupTopics(group.id)
    const isExpanded = expandedGroups.has(group.id)

    return (
      <GroupContainer
        key={group.id}
        data-groupid={group.id}
        onDragOver={(e) => handleTopicDragOver(e, group.id)}
        onDragLeave={handleTopicDragLeave}
        onDrop={(e) => handleTopicDrop(e, group.id)}
        className={dropTargetRef.current === group.id ? 'drag-over' : ''}>
        <GroupHeader onClick={(e) => toggleGroupExpanded(group.id, e)} className="group-header-style">
          <GroupTitle>
            <GroupIcon>{isExpanded ? <DownOutlined /> : <RightOutlined />}</GroupIcon>
            <div>{group.name}</div>
            <GroupCount>{groupTopics.length}</GroupCount>
          </GroupTitle>
          <GroupActions className="group-actions">
            <EditOutlined onClick={(e) => handleEditGroup(group, e)} />
            <DeleteOutlined
              className="delete-icon"
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteGroup(group.id)
              }}
            />
          </GroupActions>
        </GroupHeader>
        <GroupContent className={isExpanded ? 'expanded' : 'collapsed'}>
          {safeMap(groupTopics, renderTopicItem)}
        </GroupContent>
      </GroupContainer>
    )
  }

  const getTopicMenuItems = useCallback(
    (topic: Topic) => {
      // 锁定状态下禁用的功能
      const isLocked = topic.locked === true

      const menus: MenuProps['items'] = [
        {
          label: t('chat.topics.edit.title'),
          key: 'edit',
          icon: <EditOutlined />,
          disabled: isLocked,
          async onClick() {
            const name = await PromptPopup.show({
              title: t('chat.topics.edit.title'),
              message: '',
              defaultValue: topic.name
            })
            name && updateTopic({ ...topic, name: name.trim() })
          }
        },
        {
          label: t('chat.topics.auto_rename'),
          key: 'auto-rename',
          icon: <i className="iconfont icon-business-smart-assistant" style={{ fontSize: '14px' }} />,
          disabled: isLocked,
          onClick: () => {
            // 仅当第一条消息是用户消息时才能自动命名
            const firstMsg = topic.messages[0]
            if (firstMsg && firstMsg.role === 'user') {
              // 直接触发自动重命名事件
              EventEmitter.emit(EVENT_NAMES.AI_AUTO_RENAME)
            }
          }
        },
        {
          label: t('chat.topics.prompt'),
          key: 'topic-prompt',
          icon: <i className="iconfont icon-ai-model1" style={{ fontSize: '14px' }} />,
          disabled: isLocked,
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
          label: topic.locked ? t('chat.topics.unlock') : t('chat.topics.lock'),
          key: 'lock',
          icon: topic.locked ? <UnlockOutlined /> : <LockOutlined />,
          onClick() {
            onLockTopic(topic)
          }
        },
        {
          label: t('chat.topics.clear.title'),
          key: 'clear-messages',
          icon: <ClearOutlined />,
          disabled: isLocked,
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
                window.api.export.toWord(markdown, topic.name)
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
        },
        {
          label: t('topics.move_to_group') || '移动到分组',
          key: 'move-to-group',
          icon: <FolderOpenOutlined />,
          children: [
            {
              label: t('topics.no_group') || '无分组',
              key: 'no-group',
              onClick: () => {
                if (assistant.id) {
                  updateTopicGroup(assistant.id, topic.id, undefined)
                }
              }
            },
            ...safeMap(topicGroups, (group) => ({
              label: group.name,
              key: group.id,
              onClick: () => {
                if (assistant.id) {
                  updateTopicGroup(assistant.id, topic.id, group.id)
                }
              }
            }))
          ]
        }
      ]

      if (assistants.length > 1 && assistant.topics.length > 1) {
        menus.push({
          label: t('chat.topics.duplicate_to') || '复制到',
          key: 'duplicate',
          icon: <RetweetOutlined />,
          children: assistants
            .filter((a) => a.id !== assistant.id)
            .map((a) => ({
              label: a.name,
              key: a.id,
              onClick: () => onDuplicateTopic(topic, a)
            }))
        })
      }

      if (assistant.topics.length > 1 && !topic.pinned && !topic.locked) {
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
      onClearMessages,
      onDeleteTopic,
      onPinTopic,
      onLockTopic,
      onDuplicateTopic,
      t,
      updateTopic,
      topicGroups,
      updateTopicGroup
    ]
  )

  return (
    <Container right={topicPosition === 'right'} className="topics-tab">
      {/* 未分组的话题 */}
      <UngroupedSection
        onDragOver={(e) => handleTopicDragOver(e, null)}
        onDragLeave={handleTopicDragLeave}
        onDrop={(e) => handleTopicDrop(e, null)}
        className={dropTargetRef.current === null ? 'drag-over' : ''}>
        <p className="section-title">{t('topics.ungrouped') || '未分组'}</p>
        {ungroupedTopics.map(renderTopicItem)}
      </UngroupedSection>

      {/* 分割线 */}
      {ungroupedTopics.length > 0 && topicGroups.length > 0 && <SectionDivider />}

      {/* 分组区域 */}
      <GroupsContainer>{safeMap(topicGroups, renderGroup)}</GroupsContainer>

      {/* 添加按钮 */}
      <ActionButtons>
        {!dragging && (
          <>
            <CreateButton type="button" onClick={handleCreateTopic}>
              <PlusOutlined />
              {t('topics.add') || '添加话题'}
            </CreateButton>
            <GroupCreateButton type="button" className="add-group-btn" onClick={handleCreateGroup}>
              <FolderAddOutlined />
              {t('topics.group.add') || '添加分组'}
            </GroupCreateButton>
          </>
        )}
      </ActionButtons>

      {/* 创建/编辑分组模态框 */}
      <Modal
        title={currentGroup ? t('topics.group.edit') || '编辑分组' : t('topics.group.add') || '添加分组'}
        open={groupModalVisible}
        onOk={handleGroupFormSubmit}
        onCancel={() => setGroupModalVisible(false)}
        destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('topics.group.name') || '分组名称'}
            rules={[
              {
                required: true,
                message: t('topics.group.name.required') || '请输入分组名称'
              }
            ]}>
            <Input placeholder={t('topics.group.name.placeholder') || '输入分组名称'} />
          </Form.Item>
          <Form.Item name="description" label={t('topics.group.description') || '分组描述'}>
            <Input.TextArea
              placeholder={t('topics.group.description.placeholder') || '输入分组描述（可选）'}
              rows={3}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Container>
  )
}

const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  padding-top: 11px;
  user-select: none;
  height: 100%;

  .topic-item-wrapper[draggable='true'] {
    cursor: grab;

    &:active {
      cursor: grabbing;
    }
  }

  /* 解决拖拽时的白边问题 */
  [draggable] {
    -webkit-user-drag: element;
    user-select: none;
  }
`

const UngroupedSection = styled.div`
  padding: 8px;
  border-radius: 8px;
  min-height: 60px;
  max-height: 300px;
  overflow-y: auto;

  .section-title {
    font-size: 13px;
    color: var(--color-text-3);
    margin: 5px 8px;
    padding-left: 8px;
  }

  &.drag-over {
    background-color: var(--color-bg-3);
  }

  .topic-item-wrapper[draggable='true'] {
    cursor: grab;
    &:active {
      cursor: grabbing;
    }
  }
`

const SectionDivider = styled.div`
  height: 1px;
  background-color: var(--color-border);
  margin: 8px 0;
`

const GroupsContainer = styled.div`
  flex: 1;
  overflow-y: auto;
`

const GroupContainer = styled.div`
  margin-bottom: 4px;
  position: relative;

  &.drag-over {
    background-color: var(--color-bg-3);
    border-radius: 6px;
  }
`

const GroupHeader = styled.div`
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
  position: relative;
  border-radius: 6px;

  &:hover {
    background-color: var(--color-bg-2);

    .group-actions {
      opacity: 1;
      visibility: visible;
    }
  }
`

const GroupTitle = styled.div`
  display: flex;
  align-items: center;
  flex-grow: 1;
  font-weight: 500;
  font-size: 13px;
`

const GroupIcon = styled.span`
  margin-right: 8px;
  font-size: 12px;
`

const GroupCount = styled.span`
  margin-left: 8px;
  color: var(--color-text-3);
  font-size: 12px;
  font-weight: normal;
`

const GroupActions = styled.div`
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s;
  display: flex;
  gap: 8px;

  .anticon {
    cursor: pointer;
    color: var(--color-text-3);
    &:hover {
      color: var(--color-text-1);
    }
  }

  .delete-icon:hover {
    color: var(--color-error);
  }
`

const GroupContent = styled.div`
  padding-left: 20px;
  overflow: hidden;

  &.expanded {
    display: block;
  }

  &.collapsed {
    display: none;
  }
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
  font-size: 13px;
  color: var(--color-text-1);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
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

const ActionButtons = styled.div`
  display: flex;
  gap: 10px;
  padding: 10px;
  margin-top: 10px;
  margin-bottom: 10px;

  button {
    flex: 1;
  }
`

const CreateButton = styled.button`
  height: 34px;
  border-radius: 6px;
  border: none;
  background-color: var(--color-primary);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.3s;

  &:hover {
    background-color: #05d47b;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    color: #fff;
  }
`

const GroupCreateButton = styled(CreateButton)`
  background-color: var(--color-neutral-5);
  color: var(--color-text-1);

  &:hover {
    background-color: var(--color-neutral-6);
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    color: var(--color-primary);
  }
`

export default Topics
