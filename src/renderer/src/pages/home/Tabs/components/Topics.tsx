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
import type { MenuProps } from 'antd'
import { Dropdown, Tooltip } from 'antd'
import type { ItemType, MenuItemType } from 'antd/es/menu/interface'
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
import styled from 'styled-components'

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

  const [_targetTopic, setTargetTopic] = useState<Topic | null>(null)
  const targetTopic = useDeferredValue(_targetTopic)
  const getTopicMenuItems = useMemo(() => {
    const topic = targetTopic
    if (!topic) return []

    const menus: MenuProps['items'] = [
      {
        label: t('chat.topics.auto_rename'),
        key: 'auto-rename',
        icon: <Sparkles size={14} />,
        disabled: isRenaming(topic.id),
        async onClick() {
          const messages = await getTopicMessages(topic.id)
          if (messages.length >= 2) {
            startTopicRenaming(topic.id)
            try {
              const { text: summaryText, error } = await fetchMessagesSummary({ messages })
              if (summaryText) {
                const updatedTopic = { ...topic, name: summaryText, isNameManuallyEdited: false }
                void updateTopic(updatedTopic)
              } else if (error) {
                window.toast?.error(`${t('message.error.fetchTopicName')}: ${error}`)
              }
            } finally {
              finishTopicRenaming(topic.id)
            }
          }
        }
      },
      {
        label: t('chat.topics.edit.title'),
        key: 'rename',
        icon: <EditIcon size={14} />,
        disabled: isRenaming(topic.id),
        async onClick() {
          const name = await PromptPopup.show({
            title: t('chat.topics.edit.title'),
            message: '',
            defaultValue: topic?.name || '',
            extraNode: (
              <div style={{ color: 'var(--color-text-3)', marginTop: 8 }}>{t('chat.topics.edit.title_tip')}</div>
            )
          })
          if (name && topic?.name !== name) {
            const updatedTopic = { ...topic, name, isNameManuallyEdited: true }
            void updateTopic(updatedTopic)
          }
        }
      },
      {
        label: topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin'),
        key: 'pin',
        icon: topic.pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />,
        onClick() {
          void onPinTopic(topic)
        }
      },
      {
        label: t('notes.save'),
        key: 'notes',
        icon: <NotebookPen size={14} />,
        onClick: async () => {
          void exportTopicToNotes(topic, notesPath)
        }
      },
      {
        label: t('chat.topics.clear.title'),
        key: 'clear-messages',
        icon: <BrushCleaning size={14} />,
        onClick: () => onClearMessages(topic)
      },
      {
        label: t('settings.topic.position.label'),
        key: 'topic-position',
        icon: <MenuIcon size={14} />,
        children: [
          {
            label: t('settings.topic.position.left'),
            key: 'left',
            onClick: () => setTopicPosition('left')
          },
          {
            label: t('settings.topic.position.right'),
            key: 'right',
            onClick: () => setTopicPosition('right')
          }
        ]
      },
      {
        label: t('chat.topics.copy.title'),
        key: 'copy',
        icon: <CopyIcon size={14} />,
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
          },
          {
            label: t('chat.topics.copy.plain_text'),
            key: 'plain_text',
            onClick: () => copyTopicAsPlainText(topic)
          }
        ]
      },
      {
        label: t('chat.save.label'),
        key: 'save',
        icon: <Save size={14} />,
        children: [
          {
            label: t('chat.save.topic.knowledge.title'),
            key: 'knowledge',
            onClick: async () => {
              try {
                const result = await SaveToKnowledgePopup.showForTopic(topic)
                if (result?.success) {
                  window.toast.success(t('chat.save.topic.knowledge.success', { count: result.savedCount }))
                }
              } catch {
                window.toast.error(t('chat.save.topic.knowledge.error.save_failed'))
              }
            }
          }
        ]
      },
      {
        label: t('chat.topics.export.title'),
        key: 'export',
        icon: <UploadIcon size={14} />,
        children: [
          exportMenuOptions.image && {
            label: t('chat.topics.export.image'),
            key: 'image',
            onClick: () => EventEmitter.emit(EVENT_NAMES.EXPORT_TOPIC_IMAGE, topic)
          },
          exportMenuOptions.markdown && {
            label: t('chat.topics.export.md.label'),
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
              void window.api.export.toWord(markdown, removeSpecialCharactersForFileName(topic.name))
            }
          },
          exportMenuOptions.notion && {
            label: t('chat.topics.export.notion'),
            key: 'notion',
            onClick: async () => {
              void exportTopicToNotion(topic)
            }
          },
          exportMenuOptions.yuque && {
            label: t('chat.topics.export.yuque'),
            key: 'yuque',
            onClick: async () => {
              const markdown = await topicToMarkdown(topic)
              void exportMarkdownToYuque(topic.name, markdown)
            }
          },
          exportMenuOptions.obsidian && {
            label: t('chat.topics.export.obsidian'),
            key: 'obsidian',
            onClick: async () => {
              await ObsidianExportPopup.show({ title: topic.name, topic, processingMethod: '3' })
            }
          },
          exportMenuOptions.joplin && {
            label: t('chat.topics.export.joplin'),
            key: 'joplin',
            onClick: async () => {
              const topicMessages = await getTopicMessages(topic.id)
              void exportMarkdownToJoplin(topic.name, topicMessages)
            }
          },
          exportMenuOptions.siyuan && {
            label: t('chat.topics.export.siyuan'),
            key: 'siyuan',
            onClick: async () => {
              const markdown = await topicToMarkdown(topic)
              void exportMarkdownToSiyuan(topic.name, markdown)
            }
          }
        ].filter(Boolean) as ItemType<MenuItemType>[]
      }
    ]

    if (topics.length > 1 && !topic.pinned) {
      menus.push({ type: 'divider' })
      menus.push({
        label: t('common.delete'),
        danger: true,
        key: 'delete',
        icon: <DeleteIcon size={14} className="lucide-custom" />,
        onClick: () => onDeleteTopic(topic)
      })
    }

    return menus
  }, [
    targetTopic,
    t,
    isRenaming,
    exportMenuOptions.image,
    exportMenuOptions.markdown,
    exportMenuOptions.markdown_reason,
    exportMenuOptions.docx,
    exportMenuOptions.notion,
    exportMenuOptions.yuque,
    exportMenuOptions.obsidian,
    exportMenuOptions.joplin,
    exportMenuOptions.siyuan,
    notesPath,
    updateTopic,
    activeTopic.id,
    setActiveTopic,
    onPinTopic,
    onClearMessages,
    setTopicPosition,
    onDeleteTopic
  ])

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
            <Dropdown menu={{ items: getTopicMenuItems }} trigger={['contextMenu']} disabled={isManageMode}>
              <TopicListItem
                onMouseEnter={() =>
                  prefetch(`/topics/${topic.id}/messages`, {
                    query: { limit: 999, includeSiblings: true }
                  })
                }
                onContextMenu={() => setTargetTopic(topic)}
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
            </Dropdown>
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
