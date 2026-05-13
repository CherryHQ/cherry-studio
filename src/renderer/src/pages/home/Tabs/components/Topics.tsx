import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@cherrystudio/ui'
import { useCache } from '@data/hooks/useCache'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import AddButton from '@renderer/components/AddButton'
import AssistantAvatar from '@renderer/components/Avatar/AssistantAvatar'
import type { DraggableVirtualListRef } from '@renderer/components/DraggableList'
import { DraggableVirtualList } from '@renderer/components/DraggableList'
import { CopyIcon, DeleteIcon, EditIcon } from '@renderer/components/Icons'
import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import SaveToKnowledgePopup from '@renderer/components/Popups/SaveToKnowledgePopup'
import { isMac } from '@renderer/config/constant'
import { db } from '@renderer/databases'
import { useAssistant, useAssistants } from '@renderer/hooks/useAssistant'
import { useInPlaceEdit } from '@renderer/hooks/useInPlaceEdit'
import { modelGenerating } from '@renderer/hooks/useModel'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { finishTopicRenaming, startTopicRenaming, TopicManager } from '@renderer/hooks/useTopic'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { RootState } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { Assistant, Topic } from '@renderer/types'
import { classNames, removeSpecialCharactersForFileName } from '@renderer/utils'
import { copyTopicAsMarkdown, copyTopicAsPlainText } from '@renderer/utils/copy'
import {
  exportMarkdownToJoplin,
  exportMarkdownToSiyuan,
  exportMarkdownToYuque,
  exportTopicAsMarkdown,
  exportTopicToNotes,
  exportTopicToNotion,
  topicToMarkdown
} from '@renderer/utils/export'
import { Tooltip } from 'antd'
import dayjs from 'dayjs'
import { findIndex } from 'lodash'
import {
  BrushCleaning,
  CheckSquare,
  FolderOpen,
  HelpCircle,
  ListChecks,
  MenuIcon,
  NotebookPen,
  PackagePlus,
  PinIcon,
  PinOffIcon,
  Save,
  Sparkles,
  Square,
  UploadIcon,
  XIcon
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'
import styled from 'styled-components'

import { TopicManagePanel, useTopicManageMode } from './TopicManageMode'

const logger = loggerService.withContext('Topics')

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
}

export const Topics: React.FC<Props> = ({ assistant: _assistant, activeTopic, setActiveTopic, position }) => {
  const { t } = useTranslation()
  const { notesPath } = useNotesSettings()
  const { assistants } = useAssistants()
  const { assistant, addTopic, removeTopic, moveTopic, updateTopic, updateTopics } = useAssistant(_assistant.id)

  const [showTopicTime] = usePreference('topic.tab.show_time')
  const [pinTopicsToTop] = usePreference('topic.tab.pin_to_top')
  const [topicPosition, setTopicPosition] = usePreference('topic.position')

  const [, setGenerating] = useCache('chat.generating')

  const [renamingTopics] = useCache('topic.renaming')
  const topicLoadingQuery = useSelector((state: RootState) => state.messages.loadingByTopic)
  const topicFulfilledQuery = useSelector((state: RootState) => state.messages.fulfilledByTopic)
  const [newlyRenamedTopics] = useCache('topic.newly_renamed')

  const borderRadius = showTopicTime ? 12 : 'var(--list-item-border-radius)'

  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null)
  const deleteTimerRef = useRef<NodeJS.Timeout>(null)
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null)
  const listRef = useRef<DraggableVirtualListRef>(null)

  // 管理模式状态
  const manageState = useTopicManageMode()
  const { isManageMode, selectedIds, searchText, enterManageMode, exitManageMode, toggleSelectTopic } = manageState

  const { startEdit, isEditing, inputProps } = useInPlaceEdit({
    onSave: (name: string) => {
      const topic = assistant.topics.find((t) => t.id === editingTopicId)
      if (topic && name !== topic.name) {
        const updatedTopic = { ...topic, name, isNameManuallyEdited: true }
        updateTopic(updatedTopic)
        window.toast.success(t('common.saved'))
      }
      setEditingTopicId(null)
    },
    onCancel: () => {
      setEditingTopicId(null)
    }
  })

  const isPending = useCallback((topicId: string) => topicLoadingQuery[topicId], [topicLoadingQuery])
  const isFulfilled = useCallback((topicId: string) => topicFulfilledQuery[topicId], [topicFulfilledQuery])
  const dispatch = useDispatch()

  useEffect(() => {
    dispatch(newMessagesActions.setTopicFulfilled({ topicId: activeTopic.id, fulfilled: false }))
  }, [activeTopic.id, dispatch, topicFulfilledQuery])

  const isRenaming = useCallback(
    (topicId: string) => {
      return renamingTopics.includes(topicId)
    },
    [renamingTopics]
  )

  const isNewlyRenamed = useCallback(
    (topicId: string) => {
      return newlyRenamedTopics.includes(topicId)
    },
    [newlyRenamedTopics]
  )

  const handleDeleteClick = useCallback((topicId: string, e: React.MouseEvent) => {
    e.stopPropagation()

    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current)
    }

    setDeletingTopicId(topicId)

    deleteTimerRef.current = setTimeout(() => setDeletingTopicId(null), 2000)
  }, [])

  const onClearMessages = useCallback(
    (topic: Topic) => {
      // window.keyv.set(EVENT_NAMES.CHAT_COMPLETION_PAUSED, true)
      setGenerating(false)
      void EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
    },
    [setGenerating]
  )

  const handleConfirmDelete = useCallback(
    async (topic: Topic, e: React.MouseEvent) => {
      e.stopPropagation()
      if (assistant.topics.length === 1) {
        const newTopic = getDefaultTopic(assistant.id)
        await db.topics.add({ id: newTopic.id, messages: [] })
        addTopic(newTopic)
        setActiveTopic(newTopic)
      } else {
        const index = findIndex(assistant.topics, (t) => t.id === topic.id)
        if (topic.id === activeTopic.id) {
          setActiveTopic(assistant.topics[index + 1 === assistant.topics.length ? index - 1 : index + 1])
        }
      }
      await modelGenerating()
      removeTopic(topic)
      setDeletingTopicId(null)
    },
    [activeTopic.id, addTopic, assistant.id, assistant.topics, removeTopic, setActiveTopic]
  )

  const onPinTopic = useCallback(
    (topic: Topic) => {
      // 只有当 pinTopicsToTop 开启时才重新排序话题
      if (pinTopicsToTop) {
        let newIndex = 0

        if (topic.pinned) {
          // 取消固定：将话题移到未固定话题的顶部
          const pinnedTopics = assistant.topics.filter((t) => t.pinned)
          const unpinnedTopics = assistant.topics.filter((t) => !t.pinned)

          const reorderedTopics = [...pinnedTopics.filter((t) => t.id !== topic.id), topic, ...unpinnedTopics]

          newIndex = pinnedTopics.length - 1
          updateTopics(reorderedTopics)
        } else {
          // 固定话题：移到固定区域顶部
          const pinnedTopics = assistant.topics.filter((t) => t.pinned)
          const unpinnedTopics = assistant.topics.filter((t) => !t.pinned)

          const reorderedTopics = [topic, ...pinnedTopics, ...unpinnedTopics.filter((t) => t.id !== topic.id)]

          newIndex = 0
          updateTopics(reorderedTopics)
        }

        // 延迟滚动到话题位置（等待渲染完成）
        setTimeout(() => {
          listRef.current?.scrollToIndex(newIndex, { align: 'auto' })
        }, 50)
      }

      const updatedTopic = { ...topic, pinned: !topic.pinned }
      updateTopic(updatedTopic)
    },
    [assistant.topics, updateTopic, updateTopics, pinTopicsToTop]
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
      setActiveTopic(topic)
    },
    [setActiveTopic]
  )

  const [exportMenuOptions] = useMultiplePreferences({
    docx: 'data.export.menus.docx',
    image: 'data.export.menus.image',
    joplin: 'data.export.menus.joplin',
    markdown: 'data.export.menus.markdown',
    markdown_reason: 'data.export.menus.markdown_reason',
    notes: 'data.export.menus.notes',
    notion: 'data.export.menus.notion',
    obsidian: 'data.export.menus.obsidian',
    plain_text: 'data.export.menus.plain_text',
    siyuan: 'data.export.menus.siyuan',
    yuque: 'data.export.menus.yuque'
  })

  const handleAutoRenameTopic = useCallback(
    async (topic: Topic) => {
      const messages = await TopicManager.getTopicMessages(topic.id)
      if (messages.length < 2) return
      startTopicRenaming(topic.id)
      try {
        const { text: summaryText, error } = await fetchMessagesSummary({ messages })
        if (summaryText) {
          updateTopic({ ...topic, name: summaryText, isNameManuallyEdited: false })
        } else if (error) {
          window.toast.error(`${t('message.error.fetchTopicName')}: ${error}`)
        }
      } catch (error) {
        logger.error('auto-rename failed', error as Error)
        window.toast.error(`${t('message.error.fetchTopicName')}: ${(error as Error).message ?? ''}`)
      } finally {
        finishTopicRenaming(topic.id)
      }
    },
    [t, updateTopic]
  )

  const runExport = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn()
      } catch (error) {
        logger.error('topic export failed', error as Error)
        window.toast.error(t('chat.topics.export.failed'))
      }
    },
    [t]
  )

  const handleRenameTopic = useCallback(
    async (topic: Topic) => {
      const name = await PromptPopup.show({
        title: t('chat.topics.edit.title'),
        message: '',
        defaultValue: topic?.name || '',
        extraNode: <div className="mt-2 text-foreground-muted">{t('chat.topics.edit.title_tip')}</div>
      })
      if (name && topic?.name !== name) {
        updateTopic({ ...topic, name, isNameManuallyEdited: true })
      }
    },
    [t, updateTopic]
  )

  const handleEditPrompt = useCallback(
    async (topic: Topic) => {
      const prompt = await PromptPopup.show({
        title: t('chat.topics.prompt.edit.title'),
        message: '',
        defaultValue: topic?.prompt || '',
        inputProps: { rows: 8, allowClear: true }
      })
      if (prompt !== null) {
        const updatedTopic = { ...topic, prompt: prompt.trim() }
        updateTopic(updatedTopic)
        if (topic.id === activeTopic.id) setActiveTopic(updatedTopic)
      }
    },
    [activeTopic.id, setActiveTopic, t, updateTopic]
  )

  const handleSaveToKnowledge = useCallback(
    async (topic: Topic) => {
      try {
        const result = await SaveToKnowledgePopup.showForTopic(topic)
        if (result?.success) {
          window.toast.success(t('chat.save.topic.knowledge.success', { count: result.savedCount }))
        }
      } catch (error) {
        logger.error('save to knowledge failed', error as Error)
        window.toast.error(t('chat.save.topic.knowledge.error.save_failed'))
      }
    },
    [t]
  )

  const renderTopicMenuItems = (topic: Topic) => {
    const moveCandidates = assistants.filter((a) => a.id !== assistant.id)
    const showMove = assistants.length > 1 && assistant.topics.length > 1
    const showDelete = assistant.topics.length > 1 && !topic.pinned
    return (
      <>
        <ContextMenuItem disabled={isRenaming(topic.id)} onSelect={() => void handleAutoRenameTopic(topic)}>
          <ContextMenuItemContent icon={<Sparkles size={14} />}>{t('chat.topics.auto_rename')}</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem disabled={isRenaming(topic.id)} onSelect={() => void handleRenameTopic(topic)}>
          <ContextMenuItemContent icon={<EditIcon size={14} />}>{t('chat.topics.edit.title')}</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void handleEditPrompt(topic)}>
          <ContextMenuItemContent
            icon={<PackagePlus size={14} />}
            badge={<HelpCircle size={14} aria-label={t('chat.topics.prompt.tips')} />}>
            {t('chat.topics.prompt.label')}
          </ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onPinTopic(topic)}>
          <ContextMenuItemContent icon={topic.pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />}>
            {topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin')}
          </ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void runExport(() => exportTopicToNotes(topic, notesPath))}>
          <ContextMenuItemContent icon={<NotebookPen size={14} />}>{t('notes.save')}</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onClearMessages(topic)}>
          <ContextMenuItemContent icon={<BrushCleaning size={14} />}>
            {t('chat.topics.clear.title')}
          </ContextMenuItemContent>
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <MenuIcon size={14} />
            {t('settings.topic.position.label')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => setTopicPosition('left')}>
              {t('settings.topic.position.left')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setTopicPosition('right')}>
              {t('settings.topic.position.right')}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CopyIcon size={14} />
            {t('chat.topics.copy.title')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => EventEmitter.emit(EVENT_NAMES.COPY_TOPIC_IMAGE, topic)}>
              {t('chat.topics.copy.image')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => copyTopicAsMarkdown(topic)}>{t('chat.topics.copy.md')}</ContextMenuItem>
            <ContextMenuItem onSelect={() => copyTopicAsPlainText(topic)}>
              {t('chat.topics.copy.plain_text')}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Save size={14} />
            {t('chat.save.label')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => void handleSaveToKnowledge(topic)}>
              {t('chat.save.topic.knowledge.title')}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <UploadIcon size={14} />
            {t('chat.topics.export.title')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {exportMenuOptions.image && (
              <ContextMenuItem onSelect={() => EventEmitter.emit(EVENT_NAMES.EXPORT_TOPIC_IMAGE, topic)}>
                {t('chat.topics.export.image')}
              </ContextMenuItem>
            )}
            {exportMenuOptions.markdown && (
              <ContextMenuItem onSelect={() => void runExport(() => exportTopicAsMarkdown(topic))}>
                {t('chat.topics.export.md.label')}
              </ContextMenuItem>
            )}
            {exportMenuOptions.markdown_reason && (
              <ContextMenuItem onSelect={() => void runExport(() => exportTopicAsMarkdown(topic, true))}>
                {t('chat.topics.export.md.reason')}
              </ContextMenuItem>
            )}
            {exportMenuOptions.docx && (
              <ContextMenuItem
                onSelect={() =>
                  void runExport(async () => {
                    const markdown = await topicToMarkdown(topic)
                    await window.api.export.toWord(markdown, removeSpecialCharactersForFileName(topic.name))
                  })
                }>
                {t('chat.topics.export.word')}
              </ContextMenuItem>
            )}
            {exportMenuOptions.notion && (
              <ContextMenuItem onSelect={() => void runExport(() => exportTopicToNotion(topic))}>
                {t('chat.topics.export.notion')}
              </ContextMenuItem>
            )}
            {exportMenuOptions.yuque && (
              <ContextMenuItem
                onSelect={() =>
                  void runExport(async () => {
                    const markdown = await topicToMarkdown(topic)
                    await exportMarkdownToYuque(topic.name, markdown)
                  })
                }>
                {t('chat.topics.export.yuque')}
              </ContextMenuItem>
            )}
            {exportMenuOptions.obsidian && (
              <ContextMenuItem
                onSelect={() =>
                  void runExport(() => ObsidianExportPopup.show({ title: topic.name, topic, processingMethod: '3' }))
                }>
                {t('chat.topics.export.obsidian')}
              </ContextMenuItem>
            )}
            {exportMenuOptions.joplin && (
              <ContextMenuItem
                onSelect={() =>
                  void runExport(async () => {
                    const topicMessages = await TopicManager.getTopicMessages(topic.id)
                    await exportMarkdownToJoplin(topic.name, topicMessages)
                  })
                }>
                {t('chat.topics.export.joplin')}
              </ContextMenuItem>
            )}
            {exportMenuOptions.siyuan && (
              <ContextMenuItem
                onSelect={() =>
                  void runExport(async () => {
                    const markdown = await topicToMarkdown(topic)
                    await exportMarkdownToSiyuan(topic.name, markdown)
                  })
                }>
                {t('chat.topics.export.siyuan')}
              </ContextMenuItem>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {showMove && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderOpen size={14} />
              {t('chat.topics.move_to')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {moveCandidates.map((a) => (
                <ContextMenuItem key={a.id} onSelect={() => onMoveTopic(topic, a)}>
                  <ContextMenuItemContent icon={<AssistantAvatar assistant={a} size={18} />}>
                    {a.name}
                  </ContextMenuItemContent>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        {showDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => onDeleteTopic(topic)}>
              <ContextMenuItemContent icon={<DeleteIcon size={14} className="lucide-custom" />}>
                {t('common.delete')}
              </ContextMenuItemContent>
            </ContextMenuItem>
          </>
        )}
      </>
    )
  }

  // Sort topics based on pinned status if pinTopicsToTop is enabled
  const sortedTopics = useMemo(() => {
    if (pinTopicsToTop) {
      return [...assistant.topics].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1
        if (!a.pinned && b.pinned) return 1
        return 0
      })
    }
    return assistant.topics
  }, [assistant.topics, pinTopicsToTop])

  // Filter topics based on search text (only in manage mode)
  // Supports: case-insensitive, space-separated keywords (all must match)
  const deferredSearchText = useDeferredValue(searchText)
  const filteredTopics = useMemo(() => {
    if (!isManageMode || !deferredSearchText.trim()) {
      return sortedTopics
    }
    // Split by spaces and filter out empty strings
    const keywords = deferredSearchText
      .toLowerCase()
      .split(/\s+/)
      .filter((k) => k.length > 0)
    if (keywords.length === 0) {
      return sortedTopics
    }
    // All keywords must match (AND logic)
    return sortedTopics.filter((topic) => {
      const lowerName = topic.name.toLowerCase()
      return keywords.every((keyword) => lowerName.includes(keyword))
    })
  }, [sortedTopics, deferredSearchText, isManageMode])

  const singlealone = topicPosition === 'right' && position === 'right'

  return (
    <>
      <DraggableVirtualList
        ref={listRef}
        className="topics-tab"
        list={filteredTopics}
        onUpdate={updateTopics}
        style={{ height: '100%', padding: '8px 0 10px 10px', paddingBottom: isManageMode ? 70 : 10 }}
        itemContainerStyle={{ paddingBottom: '8px' }}
        header={
          <HeaderRow>
            <AddButton onClick={() => EventEmitter.emit(EVENT_NAMES.ADD_NEW_TOPIC)} className="">
              {t('chat.add.topic.title')}
            </AddButton>
            <Tooltip title={t('chat.topics.manage.title')} mouseEnterDelay={0.5}>
              <HeaderIconButton
                onClick={isManageMode ? exitManageMode : enterManageMode}
                className={isManageMode ? 'active' : ''}>
                <ListChecks size={14} />
              </HeaderIconButton>
            </Tooltip>
          </HeaderRow>
        }
        disabled={isManageMode}>
        {(topic) => {
          const isActive = topic.id === activeTopic?.id
          const topicName = topic.name.replace('`', '')
          const topicPrompt = topic.prompt
          const fullTopicPrompt = t('common.prompt') + ': ' + topicPrompt
          const isSelected = selectedIds.has(topic.id)
          const canSelect = !topic.pinned

          const getTopicNameClassName = () => {
            if (isRenaming(topic.id)) return 'animation-shimmer'
            if (isNewlyRenamed(topic.id)) return 'animation-reveal'
            return ''
          }

          const handleItemClick = () => {
            if (isManageMode) {
              if (canSelect) {
                toggleSelectTopic(topic.id)
              }
            } else {
              void onSwitchTopic(topic)
            }
          }

          return (
            <ContextMenu key={topic.id}>
              <ContextMenuTrigger asChild disabled={isManageMode}>
                <TopicListItem
                  className={classNames(
                    isActive && !isManageMode ? 'active' : '',
                    singlealone ? 'singlealone' : '',
                    isManageMode && isSelected ? 'selected' : '',
                    isManageMode && !canSelect ? 'disabled' : ''
                  )}
                  onClick={editingTopicId === topic.id && isEditing ? undefined : handleItemClick}
                  style={{
                    borderRadius,
                    cursor:
                      editingTopicId === topic.id && isEditing
                        ? 'default'
                        : isManageMode && !canSelect
                          ? 'not-allowed'
                          : 'pointer'
                  }}>
                  {isPending(topic.id) && !isActive && <PendingIndicator />}
                  {isFulfilled(topic.id) && !isActive && <FulfilledIndicator />}
                  <TopicNameContainer>
                    {isManageMode && (
                      <SelectIcon className={!canSelect ? 'disabled' : ''}>
                        {isSelected ? (
                          <CheckSquare size={16} color="var(--color-primary)" />
                        ) : (
                          <Square size={16} className="text-foreground-muted" />
                        )}
                      </SelectIcon>
                    )}
                    {editingTopicId === topic.id && isEditing ? (
                      <TopicEditInput {...inputProps} onClick={(e) => e.stopPropagation()} />
                    ) : (
                      <TopicName
                        className={getTopicNameClassName()}
                        title={topicName}
                        onDoubleClick={
                          isManageMode
                            ? undefined
                            : () => {
                                setEditingTopicId(topic.id)
                                startEdit(topic.name)
                              }
                        }>
                        {topicName}
                      </TopicName>
                    )}
                    {!topic.pinned && (
                      <Tooltip
                        placement="bottom"
                        mouseEnterDelay={0.7}
                        mouseLeaveDelay={0}
                        title={
                          <div style={{ fontSize: '12px', opacity: 0.8, fontStyle: 'italic' }}>
                            {t('chat.topics.delete.shortcut', { key: isMac ? '⌘' : 'Ctrl' })}
                          </div>
                        }>
                        <MenuButton
                          className="menu"
                          onClick={(e) => {
                            if (e.ctrlKey || e.metaKey) {
                              void handleConfirmDelete(topic, e)
                            } else if (deletingTopicId === topic.id) {
                              void handleConfirmDelete(topic, e)
                            } else {
                              handleDeleteClick(topic.id, e)
                            }
                          }}>
                          {deletingTopicId === topic.id ? (
                            <DeleteIcon size={14} className="pointer-events-none text-destructive" />
                          ) : (
                            <XIcon size={14} className="pointer-events-none text-foreground-muted" />
                          )}
                        </MenuButton>
                      </Tooltip>
                    )}
                    {topic.pinned && (
                      <MenuButton className="pin">
                        <PinIcon size={14} className="text-foreground-muted" />
                      </MenuButton>
                    )}
                  </TopicNameContainer>
                  {topicPrompt && (
                    <TopicPromptText className="prompt" title={fullTopicPrompt}>
                      {fullTopicPrompt}
                    </TopicPromptText>
                  )}
                  {showTopicTime && (
                    <TopicTime className="time">{dayjs(topic.createdAt).format('YYYY/MM/DD HH:mm')}</TopicTime>
                  )}
                </TopicListItem>
              </ContextMenuTrigger>
              <ContextMenuContent>{renderTopicMenuItems(topic)}</ContextMenuContent>
            </ContextMenu>
          )
        }}
      </DraggableVirtualList>

      {/* 管理模式底部面板 */}
      <TopicManagePanel
        assistant={assistant}
        assistants={assistants}
        activeTopic={activeTopic}
        setActiveTopic={setActiveTopic}
        updateTopics={updateTopics}
        moveTopic={moveTopic}
        manageState={manageState}
        filteredTopics={filteredTopics}
      />
    </>
  )
}

const TopicListItem = styled.div`
  padding: 7px 12px;
  border-radius: var(--list-item-border-radius);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
  width: calc(var(--assistants-width) - 20px);

  .menu {
    opacity: 0;
    color: var(--color-text-3);
  }

  &:hover {
    background-color: var(--color-list-item-hover);
    transition: background-color 0.1s;

    .menu {
      opacity: 1;
    }
  }

  &.active {
    background-color: var(--color-list-item);
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    .menu {
      opacity: 1;

      &:hover {
        color: var(--color-text-2);
      }
    }
  }
  &.singlealone {
    &:hover {
      background-color: var(--color-background-soft);
    }
    &.active {
      background-color: var(--color-background-mute);
      box-shadow: none;
    }
  }

  &.selected {
    background-color: var(--color-primary-bg);
    box-shadow: inset 0 0 0 1px var(--color-primary);
  }

  &.disabled {
    opacity: 0.5;
  }
`

const TopicNameContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  height: 20px;
`

const TopicName = styled.div`
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  position: relative;
  flex: 1;
  text-align: left;

  &.animation-reveal {
    -webkit-line-clamp: unset;
    -webkit-box-orient: unset;
  }
`

const TopicEditInput = styled.input`
  background: var(--color-background);
  border: none;
  color: var(--color-text-1);
  font-size: 13px;
  font-family: inherit;
  padding: 2px 6px;
  width: 100%;
  outline: none;
  padding: 0;
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
  background-color: var(--color-status-warning);
`

const FulfilledIndicator = styled.div.attrs({
  className: 'animation-pulse'
})`
  --pulse-size: 5px;
  width: 5px;
  height: 5px;
  position: absolute;
  left: 3px;
  top: 15px;
  border-radius: 50%;
  background-color: var(--color-status-success);
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
  min-width: 20px;
  min-height: 20px;
  .anticon {
    font-size: 12px;
  }
`

const HeaderRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding-right: 10px;
  margin-bottom: 8px;
  margin-top: 2px;
`

const HeaderIconButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  min-width: 32px;
  min-height: 32px;
  border-radius: var(--list-item-border-radius);
  cursor: pointer;
  color: var(--color-text-2);
  transition: all 0.2s;

  &:hover {
    background-color: var(--color-background-mute);
    color: var(--color-text-1);
  }

  &.active {
    color: var(--color-primary);

    &:hover {
      background-color: var(--color-background-mute);
    }
  }
`

const SelectIcon = styled.div`
  display: flex;
  align-items: center;
  margin-right: 4px;

  &.disabled {
    opacity: 0.5;
  }
`
