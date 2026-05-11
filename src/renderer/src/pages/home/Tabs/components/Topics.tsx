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
import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { useCache } from '@data/hooks/useCache'
import { useQuery } from '@data/hooks/useDataApi'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import AddButton from '@renderer/components/AddButton'
import type { DraggableVirtualListRef } from '@renderer/components/DraggableList'
import { DraggableVirtualList } from '@renderer/components/DraggableList'
import { CopyIcon, DeleteIcon, EditIcon } from '@renderer/components/Icons'
import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import SaveToKnowledgePopup from '@renderer/components/Popups/SaveToKnowledgePopup'
import { isMac } from '@renderer/config/constant'
import { prefetch } from '@renderer/data/hooks/useDataApi'
import { useInPlaceEdit } from '@renderer/hooks/useInPlaceEdit'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { finishTopicRenaming, getTopicMessages, startTopicRenaming } from '@renderer/hooks/useTopic'
import { mapApiTopicToRendererTopic, useAllTopics, useTopicMutations } from '@renderer/hooks/useTopicDataApi'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
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
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import { Tooltip } from 'antd'
import dayjs from 'dayjs'
import { findIndex } from 'lodash'
import {
  BrushCleaning,
  CheckSquare,
  ListChecks,
  MenuIcon,
  NotebookPen,
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

import { TopicManagePanel, useTopicManageMode } from './TopicManageMode'

const logger = loggerService.withContext('Topics')

interface Props {
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
}

export const Topics: React.FC<Props> = ({ activeTopic, setActiveTopic, position }) => {
  const { t } = useTranslation()
  const { notesPath } = useNotesSettings()
  const { updateTopic: patchTopic, deleteTopic: deleteTopicById, refreshTopics } = useTopicMutations()
  const removeTopic = useCallback((topic: Topic) => deleteTopicById(topic.id), [deleteTopicById])
  const updateTopic = useCallback(
    (topic: Topic) =>
      patchTopic(topic.id, {
        name: topic.name,
        isNameManuallyEdited: topic.isNameManuallyEdited
      }),
    [patchTopic]
  )

  // Pin state lives on the polymorphic `pin` table now, not on the topic
  // row — fetch it separately and overlay onto the topic list. Pin order
  // (where pinned topics sit relative to each other) is independent from
  // topic order; the server-side composed `/topics` view does the
  // pinned-first ordering for us, so the renderer only needs to know which
  // ids are pinned (for UI styling and the pin/unpin toggle).
  const { data: pinList } = useQuery('/pins', { query: { entityType: 'topic' } })
  const pinByTopicId = useMemo(() => new Map((pinList ?? []).map((p) => [p.entityId, p.id] as const)), [pinList])

  const { topics: apiTopics } = useAllTopics({ loadAll: true })
  const topics = useMemo(
    () =>
      apiTopics.map((t) => {
        const r = mapApiTopicToRendererTopic(t)
        return { ...r, pinned: pinByTopicId.has(t.id) }
      }),
    [apiTopics, pinByTopicId]
  )

  // Drag-reorder via the canonical fractional-indexing endpoint:
  // `PATCH /topics/:id/order` with `{ before }` or `{ after }`. We compute the
  // anchor from the new index in the dropped list — `position: 'first'` for
  // index 0, otherwise `{ after: previousNeighbor.id }`. This replaces the
  // legacy `batchUpdateTopics` that wrote `sortOrder` integers (the column is
  // gone). Cross-section drags (pinning / unpinning by drag) are handled at
  // pinPanel level via /pins POST/DELETE; same-section drags route here.
  const updateTopics = useCallback(
    async (reordered: Topic[]) => {
      // Diff to find moved topics — the drag library hands back the full new
      // ordering so we'd otherwise PATCH every row. Compute the minimal set
      // by zipping against the current order and keeping only changed
      // positions; one anchor PATCH per genuinely-moved topic.
      const currentIds = topics.map((t) => t.id)
      const reorderedIds = reordered.map((t) => t.id)
      const moves: Array<{ id: string; anchor: OrderRequest }> = []
      for (let i = 0; i < reorderedIds.length; i++) {
        if (currentIds[i] === reorderedIds[i]) continue
        const id = reorderedIds[i]
        const anchor: OrderRequest = i === 0 ? { position: 'first' } : { after: reorderedIds[i - 1] }
        moves.push({ id, anchor })
      }
      if (moves.length === 0) return
      try {
        if (moves.length === 1) {
          await dataApiService.patch(`/topics/${moves[0].id}/order`, { body: moves[0].anchor })
        } else {
          await dataApiService.patch('/topics/order:batch', { body: { moves } })
        }
        await refreshTopics()
      } catch (err) {
        logger.error('Failed to reorder topics', { err })
      }
    },
    [topics, refreshTopics]
  )

  const [showTopicTime] = usePreference('topic.tab.show_time')
  const [pinTopicsToTop] = usePreference('topic.tab.pin_to_top')
  const [topicPosition, setTopicPosition] = usePreference('topic.position')

  const [renamingTopics] = useCache('topic.renaming')
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
      const topic = topics.find((t) => t.id === editingTopicId)
      if (topic && name !== topic.name) {
        const updatedTopic = { ...topic, name, isNameManuallyEdited: true }
        void updateTopic(updatedTopic)
        window.toast.success(t('common.saved'))
      }
      setEditingTopicId(null)
    },
    onCancel: () => {
      setEditingTopicId(null)
    }
  })

  useEffect(() => {
    // Mark the fulfilled badge as consumed when the user opens the
    // topic. The shared stream status stays `done` globally; each
    // window tracks its own "already seen" flag in the local cache.
    const key = `topic.stream.seen.${activeTopic.id}` as const
    if (cacheService.get(key) !== true) {
      cacheService.set(key, true)
    }
  }, [activeTopic.id])

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

  const onClearMessages = useCallback((topic: Topic) => {
    void EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
  }, [])

  const handleConfirmDelete = useCallback(
    async (topic: Topic, e: React.MouseEvent) => {
      e.stopPropagation()
      try {
        await removeTopic(topic)
      } catch (err) {
        logger.error('Failed to delete topic', { topicId: topic.id, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        window.toast.error(message)
        setDeletingTopicId(null)
        return
      }
      // Topics are no longer assistant-scoped — when the deleted row was the
      // active one, hop to its neighbour. An empty list now shows an empty
      // state instead of auto-seeding a fresh topic.
      if (topic.id === activeTopic.id && topics.length > 1) {
        const index = findIndex(topics, (t) => t.id === topic.id)
        setActiveTopic(topics[index + 1 === topics.length ? index - 1 : index + 1])
      }
      setDeletingTopicId(null)
    },
    [activeTopic.id, topics, removeTopic, setActiveTopic, t]
  )

  const onPinTopic = useCallback(
    async (topic: Topic) => {
      // Pin state moved to the polymorphic `pin` table — pin = POST /pins,
      // unpin = DELETE /pins/:pinId. The server-composed `/topics` view
      // re-orders pinned-first on revalidate, so we don't manually reshuffle
      // the array anymore — the PATCHes that the legacy code did to write
      // `sortOrder` integers are gone.
      try {
        if (topic.pinned) {
          const pinId = pinByTopicId.get(topic.id)
          if (pinId) {
            await dataApiService.delete(`/pins/${pinId}`)
          }
        } else {
          await dataApiService.post('/pins', { body: { entityType: 'topic', entityId: topic.id } })
        }
        await refreshTopics()
        if (pinTopicsToTop) {
          // After revalidation, the just-toggled topic lands at the head of
          // its new section — scroll there so the user sees the move.
          setTimeout(() => listRef.current?.scrollToIndex(0, { align: 'auto' }), 50)
        }
      } catch (err) {
        logger.error('Failed to toggle topic pin', { topicId: topic.id, err })
      }
    },
    [pinByTopicId, refreshTopics, pinTopicsToTop]
  )

  const onDeleteTopic = useCallback(
    async (topic: Topic) => {
      try {
        await removeTopic(topic)
      } catch (err) {
        logger.error('Failed to delete topic', { topicId: topic.id, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        window.toast.error(message)
        return
      }
      if (topic.id === activeTopic?.id) {
        const index = findIndex(topics, (t) => t.id === topic.id)
        setActiveTopic(topics[index + 1 === topics.length ? index - 1 : index + 1])
      }
    },
    [topics, removeTopic, setActiveTopic, activeTopic, t]
  )

  const onSwitchTopic = useCallback(
    (topic: Topic) => {
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
      const messages = await getTopicMessages(topic.id)
      if (messages.length < 2) return
      startTopicRenaming(topic.id)
      try {
        const { text: summaryText, error } = await fetchMessagesSummary({ messages })
        if (summaryText) {
          void updateTopic({ ...topic, name: summaryText, isNameManuallyEdited: false })
        } else if (error) {
          window.toast?.error(`${t('message.error.fetchTopicName')}: ${error}`)
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

  // Wraps every async menu handler so a thrown promise surfaces as a toast +
  // logger entry instead of dying inside Radix's `onSelect` (where antd's
  // Dropdown used to swallow it silently). Caller passes the actual work as a
  // thunk so we don't have to spell out a generic helper per call site.
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
        extraNode: <div style={{ color: 'var(--color-text-3)', marginTop: 8 }}>{t('chat.topics.edit.title_tip')}</div>
      })
      if (name && topic?.name !== name) {
        void updateTopic({ ...topic, name, isNameManuallyEdited: true })
      }
    },
    [t, updateTopic]
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
    const showDelete = topics.length > 1 && !topic.pinned
    return (
      <>
        <ContextMenuItem disabled={isRenaming(topic.id)} onSelect={() => void handleAutoRenameTopic(topic)}>
          <ContextMenuItemContent icon={<Sparkles size={14} />}>{t('chat.topics.auto_rename')}</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem disabled={isRenaming(topic.id)} onSelect={() => void handleRenameTopic(topic)}>
          <ContextMenuItemContent icon={<EditIcon size={14} />}>{t('chat.topics.edit.title')}</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void onPinTopic(topic)}>
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
                    const topicMessages = await getTopicMessages(topic.id)
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
      return [...topics].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1
        if (!a.pinned && b.pinned) return 1
        return 0
      })
    }
    return topics
  }, [topics, pinTopicsToTop])

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
              onSwitchTopic(topic)
            }
          }

          return (
            <ContextMenu key={topic.id}>
              <ContextMenuTrigger asChild disabled={isManageMode}>
                <TopicListItem
                  onMouseEnter={() =>
                    prefetch(`/topics/${topic.id}/messages`, {
                      query: { limit: 999, includeSiblings: true }
                    })
                  }
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
                  {!isActive && <TopicStreamIndicator topicId={topic.id} />}
                  <TopicNameContainer>
                    {isManageMode && (
                      <SelectIcon className={!canSelect ? 'disabled' : ''}>
                        {isSelected ? (
                          <CheckSquare size={16} color="var(--color-primary)" />
                        ) : (
                          <Square size={16} color="var(--color-text-3)" />
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
                            <DeleteIcon size={14} color="var(--color-error)" style={{ pointerEvents: 'none' }} />
                          ) : (
                            <XIcon size={14} color="var(--color-text-3)" style={{ pointerEvents: 'none' }} />
                          )}
                        </MenuButton>
                      </Tooltip>
                    )}
                    {topic.pinned && (
                      <MenuButton className="pin">
                        <PinIcon size={14} color="var(--color-text-3)" />
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
        topics={topics}
        activeTopic={activeTopic}
        setActiveTopic={setActiveTopic}
        updateTopics={updateTopics}
        manageState={manageState}
        filteredTopics={filteredTopics}
      />
    </>
  )
}

const TopicListItem = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={classNames(
      'flex w-[calc(var(--assistants-width)-20px)] cursor-pointer flex-col justify-between rounded-(--list-item-border-radius) px-3 py-[7px] text-[13px] hover:bg-(--color-list-item-hover) hover:transition-colors hover:duration-100 [&.active]:bg-(--color-list-item) [&.active]:shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] [&.active_.menu:hover]:text-(--color-text-2) [&.active_.menu]:opacity-100 [&.disabled]:opacity-50 [&.selected]:bg-(--color-primary-bg) [&.selected]:shadow-[inset_0_0_0_1px_var(--color-primary)] [&.singlealone.active]:bg-(--color-background-mute) [&.singlealone.active]:shadow-none [&.singlealone:hover]:bg-(--color-background-soft) [&_.menu]:text-(--color-text-3) [&_.menu]:opacity-0 hover:[&_.menu]:opacity-100',
      className
    )}
    {...props}
  />
)

const TopicNameContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={classNames('flex h-5 flex-row items-center gap-1', className)} {...props} />
)

const TopicName = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={classNames(
      'relative flex-1 overflow-hidden text-left text-[13px] [-webkit-box-orient:vertical] [-webkit-line-clamp:1] [display:-webkit-box] [&.animation-reveal]:[-webkit-box-orient:unset] [&.animation-reveal]:[-webkit-line-clamp:unset]',
      className
    )}
    {...props}
  />
)

const TopicEditInput = ({ className, ...props }: React.ComponentPropsWithoutRef<'input'>) => (
  <input
    className={classNames(
      'w-full border-none bg-(--color-background) p-0 font-[inherit] text-(--color-text-1) text-[13px] outline-none',
      className
    )}
    {...props}
  />
)

/**
 * Reads the per-topic stream status reactively. Lives as a sub-component
 * so each row's `useCache` hook subscribes only to its own key — changes
 * to one topic don't re-render the siblings, and we avoid the old
 * `streamActiveCount` tripwire.
 */
const TopicStreamIndicator = ({ topicId }: { topicId: string }) => {
  const { isPending, isFulfilled } = useTopicStreamStatus(topicId)
  if (isPending) return <PendingIndicator />
  if (isFulfilled) return <FulfilledIndicator />
  return null
}

const PendingIndicator = () => (
  <div className="animation-pulse absolute top-[15px] left-[3px] h-[5px] w-[5px] rounded-full bg-(--color-status-warning) [--pulse-size:5px]" />
)

const FulfilledIndicator = () => (
  <div className="animation-pulse absolute top-[15px] left-[3px] h-[5px] w-[5px] rounded-full bg-(--color-status-success) [--pulse-size:5px]" />
)

const TopicPromptText = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={classNames(
      'overflow-hidden text-(--color-text-2) text-xs [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box] [&~_.prompt-text]:mt-2.5',
      className
    )}
    {...props}
  />
)

const TopicTime = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={classNames('text-(--color-text-3) text-[11px]', className)} {...props} />
)

const MenuButton = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={classNames('flex min-h-5 min-w-5 flex-row items-center justify-center [&_.anticon]:text-xs', className)}
    {...props}
  />
)

const HeaderRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={classNames('mt-0.5 mb-2 flex flex-row items-center gap-1.5 pr-2.5', className)} {...props} />
)

const HeaderIconButton = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={classNames(
      'flex h-8 min-h-8 w-8 min-w-8 cursor-pointer items-center justify-center rounded-(--list-item-border-radius) text-(--color-text-2) transition-all duration-200 hover:bg-(--color-background-mute) hover:text-(--color-text-1) [&.active:hover]:bg-(--color-background-mute) [&.active]:text-(--color-primary)',
      className
    )}
    {...props}
  />
)

const SelectIcon = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={classNames('mr-1 flex items-center [&.disabled]:opacity-50', className)} {...props} />
)
