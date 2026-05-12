import {
  Button,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { useCache } from '@data/hooks/useCache'
import { useQuery } from '@data/hooks/useDataApi'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import {
  ResourceList,
  type ResourceListReorderPayload,
  TopicResourceList,
  useResourceList
} from '@renderer/components/chat/resources'
import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import SaveToKnowledgePopup from '@renderer/components/Popups/SaveToKnowledgePopup'
import { isMac } from '@renderer/config/constant'
import { prefetch } from '@renderer/data/hooks/useDataApi'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { finishTopicRenaming, getTopicMessages, startTopicRenaming } from '@renderer/hooks/useTopic'
import { mapApiTopicToRendererTopic, useAllTopics, useTopicMutations } from '@renderer/hooks/useTopicDataApi'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
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
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import { cn } from '@renderer/utils/style'
import { findIndex } from 'lodash'
import {
  BrushCleaning,
  Check,
  CheckSquare,
  ChevronsUpDown,
  Clock3,
  Copy,
  Edit3,
  FileText,
  Image,
  ListChecks,
  ListFilter,
  MenuIcon,
  NotebookPen,
  PinIcon,
  PinOffIcon,
  Save,
  Sparkles,
  Square,
  Trash2,
  UploadIcon,
  XIcon
} from 'lucide-react'
import type { MouseEvent, RefObject } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  buildTopicOrderMoves,
  createTopicDisplayGroupResolver,
  filterTopicsForManageMode,
  moveTopicAfterDrop,
  sortTopicsForDisplayGroups
} from './TopicListV2.helpers'
import { TopicManagePanel, useTopicManageMode } from './TopicManageMode'

const logger = loggerService.withContext('TopicListV2')

interface Props {
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
}

type ExportMenuOptions = Record<
  | 'docx'
  | 'image'
  | 'joplin'
  | 'markdown'
  | 'markdown_reason'
  | 'notes'
  | 'notion'
  | 'obsidian'
  | 'plain_text'
  | 'siyuan'
  | 'yuque',
  boolean
>

type TopicDisplayPreviewMode = 'time' | 'assistant' | 'tag'

const TOPIC_DISPLAY_OPTIONS: TopicDisplayPreviewMode[] = ['time', 'assistant', 'tag']
const TOPIC_DISPLAY_MODE: TopicDisplayPreviewMode = 'time'

function TopicDisplayModeMenu() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const mode = TOPIC_DISPLAY_MODE

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t('chat.topics.display.title')}
          className="size-7 shrink-0 text-muted-foreground shadow-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <ListFilter size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={6} className="w-44 rounded-lg border-border p-2 shadow-md">
        <MenuList className="gap-1">
          <div className="px-2 py-1 font-medium text-muted-foreground text-xs">{t('chat.topics.display.title')}</div>
          {TOPIC_DISPLAY_OPTIONS.map((option) => (
            <MenuItem
              key={option}
              label={t(`chat.topics.display.${option}`)}
              active={mode === option}
              suffix={mode === option ? <Check size={14} /> : null}
              className="h-8 rounded-md px-2 text-sm"
              onClick={() => {
                // TODO(topic-display-mode): wire persisted display-mode selection and derived groups in the logic phase.
                setOpen(false)
              }}
            />
          ))}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}

export function TopicListV2({ activeTopic, setActiveTopic, position }: Props) {
  const { t } = useTranslation()
  const { notesPath } = useNotesSettings()
  const { updateTopic: patchTopic, deleteTopic: deleteTopicById, refreshTopics } = useTopicMutations()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [topicPosition, setTopicPosition] = usePreference('topic.position')
  const [renamingTopics] = useCache('topic.renaming')
  const [newlyRenamedTopics] = useCache('topic.newly_renamed')
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

  const { data: pinList } = useQuery('/pins', { query: { entityType: 'topic' } })
  const pinByTopicId = useMemo(() => new Map((pinList ?? []).map((p) => [p.entityId, p.id] as const)), [pinList])
  const { topics: apiTopics, isLoading, error } = useAllTopics({ loadAll: true })
  const visibleTopicsRef = useRef<readonly Topic[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const deleteTimerRef = useRef<NodeJS.Timeout>(null)
  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null)

  const topics = useMemo(
    () =>
      apiTopics.map((apiTopic) => {
        const topic = mapApiTopicToRendererTopic(apiTopic)
        return { ...topic, pinned: pinByTopicId.has(apiTopic.id) }
      }),
    [apiTopics, pinByTopicId]
  )

  const manageState = useTopicManageMode()
  const { isManageMode, selectedIds, searchText, enterManageMode, exitManageMode, toggleSelectTopic } = manageState
  const deferredSearchText = useDeferredValue(searchText)

  useEffect(() => {
    const key = `topic.stream.seen.${activeTopic.id}` as const
    if (cacheService.get(key) !== true) {
      cacheService.set(key, true)
    }
  }, [activeTopic.id])

  const updateTopic = useCallback(
    (topic: Topic) =>
      patchTopic(topic.id, {
        name: topic.name,
        isNameManuallyEdited: topic.isNameManuallyEdited
      }),
    [patchTopic]
  )

  const removeTopic = useCallback((topic: Topic) => deleteTopicById(topic.id), [deleteTopicById])

  const applyTopicOrder = useCallback(
    async (reordered: readonly Topic[]) => {
      const sourceTopics = visibleTopicsRef.current.length > 0 ? visibleTopicsRef.current : topics
      const currentIds = sourceTopics.map((topic) => topic.id)
      const reorderedIds = reordered.map((topic) => topic.id)
      const moves = buildTopicOrderMoves(currentIds, reorderedIds)

      if (moves.length === 0) return

      try {
        if (moves.length === 1) {
          await dataApiService.patch(`/topics/${moves[0].id}/order`, { body: moves[0].anchor })
        } else {
          await dataApiService.patch('/topics/order:batch', {
            body: { moves }
          })
        }
        await refreshTopics()
      } catch (err) {
        logger.error('Failed to reorder topics', { err })
      }
    },
    [refreshTopics, topics]
  )

  const handleReorder = useCallback(
    (payload: ResourceListReorderPayload) => {
      const sourceTopics = visibleTopicsRef.current.length > 0 ? visibleTopicsRef.current : topics
      void applyTopicOrder(moveTopicAfterDrop(sourceTopics, payload))
    },
    [applyTopicOrder, topics]
  )

  const handleRenameTopic = useCallback(
    (topicId: string, name: string) => {
      const topic = topics.find((candidate) => candidate.id === topicId)
      const trimmedName = name.trim()
      if (!topic || !trimmedName || trimmedName === topic.name) return

      void updateTopic({ ...topic, name: trimmedName, isNameManuallyEdited: true })
      window.toast.success(t('common.saved'))
    },
    [topics, t, updateTopic]
  )

  const isRenaming = useCallback((topicId: string) => renamingTopics.includes(topicId), [renamingTopics])
  const isNewlyRenamed = useCallback((topicId: string) => newlyRenamedTopics.includes(topicId), [newlyRenamedTopics])

  const handleDeleteClick = useCallback((topicId: string, event: MouseEvent) => {
    event.stopPropagation()

    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current)
    }

    setDeletingTopicId(topicId)
    deleteTimerRef.current = setTimeout(() => setDeletingTopicId(null), 2000)
  }, [])

  const handleConfirmDelete = useCallback(
    async (topic: Topic, event?: MouseEvent) => {
      event?.stopPropagation()

      try {
        await removeTopic(topic)
      } catch (err) {
        logger.error('Failed to delete topic', { topicId: topic.id, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        window.toast.error(message)
        setDeletingTopicId(null)
        return
      }

      if (topic.id === activeTopic.id && topics.length > 1) {
        const index = findIndex(topics, (candidate) => candidate.id === topic.id)
        setActiveTopic(topics[index + 1 === topics.length ? index - 1 : index + 1])
      }
      setDeletingTopicId(null)
    },
    [activeTopic.id, removeTopic, setActiveTopic, t, topics]
  )

  const handlePinTopic = useCallback(
    async (topic: Topic) => {
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
        if (!topic.pinned) {
          setTimeout(() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 50)
        }
      } catch (err) {
        logger.error('Failed to toggle topic pin', { topicId: topic.id, err })
      }
    },
    [pinByTopicId, refreshTopics]
  )

  const handleDeleteTopicFromMenu = useCallback(
    async (topic: Topic) => {
      try {
        await removeTopic(topic)
      } catch (err) {
        logger.error('Failed to delete topic', { topicId: topic.id, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        window.toast.error(message)
        return
      }

      if (topic.id === activeTopic.id && topics.length > 1) {
        const index = findIndex(topics, (candidate) => candidate.id === topic.id)
        setActiveTopic(topics[index + 1 === topics.length ? index - 1 : index + 1])
      }
    },
    [activeTopic.id, removeTopic, setActiveTopic, t, topics]
  )

  const handleClearMessages = useCallback((topic: Topic) => {
    void EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
  }, [])

  const handleAutoRename = useCallback(
    async (topic: Topic) => {
      const messages = await getTopicMessages(topic.id)
      if (messages.length < 2) return

      startTopicRenaming(topic.id)
      try {
        const { text: summaryText, error: summaryError } = await fetchMessagesSummary({ messages })
        if (summaryText) {
          void updateTopic({ ...topic, name: summaryText, isNameManuallyEdited: false })
        } else if (summaryError) {
          window.toast?.error(`${t('message.error.fetchTopicName')}: ${summaryError}`)
        }
      } finally {
        finishTopicRenaming(topic.id)
      }
    },
    [t, updateTopic]
  )

  const handlePromptRename = useCallback(
    async (topic: Topic) => {
      const name = await PromptPopup.show({
        title: t('chat.topics.edit.title'),
        message: '',
        defaultValue: topic.name || '',
        extraNode: <div className="mt-2 text-(--color-text-3)">{t('chat.topics.edit.title_tip')}</div>
      })

      if (name && topic.name !== name) {
        void updateTopic({ ...topic, name, isNameManuallyEdited: true })
      }
    },
    [t, updateTopic]
  )

  const groupedTopics = useMemo(() => sortTopicsForDisplayGroups(topics), [topics])

  const filteredTopics = useMemo(
    () => filterTopicsForManageMode(groupedTopics, deferredSearchText, isManageMode),
    [deferredSearchText, groupedTopics, isManageMode]
  )

  const listStatus = error ? 'error' : isLoading ? 'loading' : filteredTopics.length === 0 ? 'empty' : 'idle'
  const singlealone = topicPosition === 'right' && position === 'right'
  const canDragTopics = !isManageMode
  const topicGroupBy = useMemo(
    () =>
      createTopicDisplayGroupResolver<Topic>({
        mode: TOPIC_DISPLAY_MODE,
        labels: {
          pinned: t('selector.common.pinned_title'),
          time: {
            today: t('chat.topics.group.today'),
            'within-week': t('chat.topics.group.within_week'),
            earlier: t('chat.topics.group.earlier')
          }
        }
      }),
    [t]
  )

  return (
    <>
      <TopicResourceList<Topic>
        items={filteredTopics}
        status={listStatus}
        selectedId={isManageMode ? null : activeTopic?.id}
        estimateItemSize={() => 40}
        groupBy={topicGroupBy}
        defaultGroupVisibleCount={5}
        groupLoadStep={5}
        groupShowMoreLabel={t('chat.topics.group.show_more')}
        onRenameItem={handleRenameTopic}
        onReorder={canDragTopics ? handleReorder : undefined}>
        <ResourceList.Header
          icon={<Clock3 size={16} />}
          title={t('chat.topics.title')}
          count={topics.length}
          actions={
            <>
              <TopicDisplayModeMenu />
              <Tooltip title={t('chat.topics.manage.title')} delay={500}>
                <ResourceList.HeaderActionButton
                  type="button"
                  aria-label={t('chat.topics.manage.title')}
                  aria-pressed={isManageMode}
                  className={cn(isManageMode && 'text-foreground')}
                  onClick={isManageMode ? exitManageMode : enterManageMode}>
                  <ListChecks size={14} />
                </ResourceList.HeaderActionButton>
              </Tooltip>
              <ResourceList.HeaderActionButton
                type="button"
                aria-label={t('shortcut.general.toggle_sidebar')}
                onClick={() => void setShowSidebar(!showSidebar)}>
                <ChevronsUpDown size={14} className="rotate-45" />
              </ResourceList.HeaderActionButton>
            </>
          }>
          <ResourceList.Search placeholder={t('chat.topics.search.placeholder')} />
        </ResourceList.Header>

        <TopicListBody
          activeTopic={activeTopic}
          deletingTopicId={deletingTopicId}
          exportMenuOptions={exportMenuOptions as ExportMenuOptions}
          isManageMode={isManageMode}
          isNewlyRenamed={isNewlyRenamed}
          isRenaming={isRenaming}
          listRef={listRef}
          notesPath={notesPath}
          onAutoRename={handleAutoRename}
          onClearMessages={handleClearMessages}
          onConfirmDelete={handleConfirmDelete}
          onDeleteClick={handleDeleteClick}
          onDeleteFromMenu={handleDeleteTopicFromMenu}
          onPinTopic={handlePinTopic}
          onPromptRename={handlePromptRename}
          onSwitchTopic={setActiveTopic}
          selectedIds={selectedIds}
          setTopicPosition={setTopicPosition}
          singlealone={singlealone}
          toggleSelectTopic={toggleSelectTopic}
          topicsLength={topics.length}
          visibleTopicsRef={visibleTopicsRef}
          canDragTopics={canDragTopics}
        />
      </TopicResourceList>

      <TopicManagePanel
        topics={topics}
        activeTopic={activeTopic}
        setActiveTopic={setActiveTopic}
        updateTopics={applyTopicOrder}
        manageState={manageState}
        filteredTopics={filteredTopics}
      />
    </>
  )
}

interface TopicListBodyProps {
  activeTopic: Topic
  canDragTopics: boolean
  deletingTopicId: string | null
  exportMenuOptions: ExportMenuOptions
  isManageMode: boolean
  isNewlyRenamed: (topicId: string) => boolean
  isRenaming: (topicId: string) => boolean
  listRef: RefObject<HTMLDivElement | null>
  notesPath: string
  onAutoRename: (topic: Topic) => Promise<void>
  onClearMessages: (topic: Topic) => void
  onConfirmDelete: (topic: Topic, event?: MouseEvent) => Promise<void>
  onDeleteClick: (topicId: string, event: MouseEvent) => void
  onDeleteFromMenu: (topic: Topic) => Promise<void>
  onPinTopic: (topic: Topic) => Promise<void>
  onPromptRename: (topic: Topic) => Promise<void>
  onSwitchTopic: (topic: Topic) => void
  selectedIds: Set<string>
  setTopicPosition: (position: 'left' | 'right') => void
  singlealone: boolean
  toggleSelectTopic: (topicId: string) => void
  topicsLength: number
  visibleTopicsRef: RefObject<readonly Topic[]>
}

function TopicListBody(props: TopicListBodyProps) {
  const { t } = useTranslation()
  const context = useResourceList<Topic>()
  props.visibleTopicsRef.current = context.view.items

  if (context.state.status === 'loading') {
    return <ResourceList.LoadingState />
  }

  if (context.state.status === 'error') {
    return <ResourceList.ErrorState message={t('error.boundary.default.message')} />
  }

  if (context.view.items.length === 0) {
    return <ResourceList.EmptyState />
  }

  const renderItem = (topic: Topic) => <TopicRow key={topic.id} topic={topic} {...props} />

  if (props.isManageMode) {
    return <ResourceList.VirtualItems ref={props.listRef} className="pb-[76px]" renderItem={renderItem} />
  }

  if (props.canDragTopics) {
    return <ResourceList.VirtualDraggableItems ref={props.listRef} className="pb-3" renderItem={renderItem} />
  }

  return <ResourceList.VirtualItems ref={props.listRef} className="pb-3" renderItem={renderItem} />
}

interface TopicRowProps extends TopicListBodyProps {
  topic: Topic
}

function TopicRow({
  activeTopic,
  deletingTopicId,
  exportMenuOptions,
  isManageMode,
  isNewlyRenamed,
  isRenaming,
  notesPath,
  onAutoRename,
  onClearMessages,
  onConfirmDelete,
  onDeleteClick,
  onDeleteFromMenu,
  onPinTopic,
  onPromptRename,
  onSwitchTopic,
  selectedIds,
  setTopicPosition,
  singlealone,
  toggleSelectTopic,
  topic,
  topicsLength
}: TopicRowProps) {
  const { t } = useTranslation()
  const context = useResourceList<Topic>()
  const isActive = topic.id === activeTopic?.id
  const isSelected = selectedIds.has(topic.id)
  const canSelect = !topic.pinned
  const topicName = topic.name.replace('`', '')
  const nameAnimationClassName = isRenaming(topic.id)
    ? 'animation-shimmer'
    : isNewlyRenamed(topic.id)
      ? 'animation-reveal'
      : ''

  const row = (
    <ResourceList.Item
      item={topic}
      data-testid="topic-list-v2-row"
      className={cn(
        'relative',
        isManageMode && isSelected && 'bg-sidebar-accent shadow-[inset_0_0_0_1px_var(--color-sidebar-active-border)]',
        isManageMode && !canSelect && 'cursor-not-allowed opacity-50',
        !singlealone && !isManageMode && isActive && 'bg-sidebar-accent',
        singlealone && !isManageMode && isActive && 'bg-sidebar-accent shadow-none',
        singlealone && !isManageMode && !isActive && 'hover:bg-(--color-background-soft)'
      )}
      style={{ cursor: isManageMode && !canSelect ? 'not-allowed' : 'pointer' }}
      onMouseEnter={() =>
        prefetch(`/topics/${topic.id}/messages`, {
          query: { limit: 999, includeSiblings: true }
        })
      }
      onClick={() => {
        if (isManageMode) {
          if (canSelect) {
            toggleSelectTopic(topic.id)
          }
          return
        }

        onSwitchTopic(topic)
      }}>
      {!isActive && <TopicStreamIndicator topicId={topic.id} />}
      {isManageMode && (
        <ResourceList.ItemIcon className={cn('mr-0.5', !canSelect && 'opacity-50')}>
          {isSelected ? (
            <CheckSquare size={16} className="text-(--color-primary)" />
          ) : (
            <Square size={16} className="text-(--color-text-3)" />
          )}
        </ResourceList.ItemIcon>
      )}
      <ResourceList.RenameField
        item={topic}
        aria-label={t('chat.topics.edit.title')}
        onClick={(event) => event.stopPropagation()}
      />
      {context.state.renamingId !== topic.id && (
        <ResourceList.ItemTitle
          title={topicName}
          className={nameAnimationClassName}
          onDoubleClick={(event) => {
            if (isManageMode) return
            event.stopPropagation()
            context.actions.startRename(topic.id)
          }}>
          {topicName}
        </ResourceList.ItemTitle>
      )}
      {!topic.pinned && (
        <Tooltip
          placement="bottom"
          delay={700}
          title={
            <span className="text-xs italic opacity-80">
              {t('chat.topics.delete.shortcut', { key: isMac ? '⌘' : 'Ctrl' })}
            </span>
          }>
          <ResourceList.ItemAction
            data-deleting={deletingTopicId === topic.id}
            onClick={(event) => {
              if (event.ctrlKey || event.metaKey || deletingTopicId === topic.id) {
                void onConfirmDelete(topic, event)
                return
              }
              onDeleteClick(topic.id, event)
            }}>
            {deletingTopicId === topic.id ? <Trash2 size={14} className="text-(--color-error)" /> : <XIcon size={14} />}
          </ResourceList.ItemAction>
        </Tooltip>
      )}
      {topic.pinned && (
        <ResourceList.ItemIcon>
          <PinIcon size={14} />
        </ResourceList.ItemIcon>
      )}
    </ResourceList.Item>
  )

  if (isManageMode) {
    return row
  }

  return (
    <ResourceList.ContextMenu
      item={topic}
      content={
        <TopicContextMenuContent
          exportMenuOptions={exportMenuOptions}
          isRenaming={isRenaming}
          notesPath={notesPath}
          onAutoRename={onAutoRename}
          onClearMessages={onClearMessages}
          onDeleteFromMenu={onDeleteFromMenu}
          onPinTopic={onPinTopic}
          onPromptRename={onPromptRename}
          setTopicPosition={setTopicPosition}
          topic={topic}
          topicsLength={topicsLength}
        />
      }>
      {row}
    </ResourceList.ContextMenu>
  )
}

interface TopicContextMenuContentProps {
  exportMenuOptions: ExportMenuOptions
  isRenaming: (topicId: string) => boolean
  notesPath: string
  onAutoRename: (topic: Topic) => Promise<void>
  onClearMessages: (topic: Topic) => void
  onDeleteFromMenu: (topic: Topic) => Promise<void>
  onPinTopic: (topic: Topic) => Promise<void>
  onPromptRename: (topic: Topic) => Promise<void>
  setTopicPosition: (position: 'left' | 'right') => void
  topic: Topic
  topicsLength: number
}

function TopicContextMenuContent({
  exportMenuOptions,
  isRenaming,
  notesPath,
  onAutoRename,
  onClearMessages,
  onDeleteFromMenu,
  onPinTopic,
  onPromptRename,
  setTopicPosition,
  topic,
  topicsLength
}: TopicContextMenuContentProps) {
  const { t } = useTranslation()

  return (
    <>
      <ContextMenuItem disabled={isRenaming(topic.id)} onSelect={() => void onAutoRename(topic)}>
        <Sparkles size={14} />
        {t('chat.topics.auto_rename')}
      </ContextMenuItem>
      <ContextMenuItem disabled={isRenaming(topic.id)} onSelect={() => void onPromptRename(topic)}>
        <Edit3 size={14} />
        {t('chat.topics.edit.title')}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void onPinTopic(topic)}>
        {topic.pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />}
        {topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin')}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void exportTopicToNotes(topic, notesPath)}>
        <NotebookPen size={14} />
        {t('notes.save')}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => onClearMessages(topic)}>
        <BrushCleaning size={14} />
        {t('chat.topics.clear.title')}
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
          <Copy size={14} />
          {t('chat.topics.copy.title')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onSelect={() => EventEmitter.emit(EVENT_NAMES.COPY_TOPIC_IMAGE, topic)}>
            <Image size={14} />
            {t('chat.topics.copy.image')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => copyTopicAsMarkdown(topic)}>
            <FileText size={14} />
            {t('chat.topics.copy.md')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => copyTopicAsPlainText(topic)}>
            <FileText size={14} />
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
          <ContextMenuItem
            onSelect={async () => {
              try {
                const result = await SaveToKnowledgePopup.showForTopic(topic)
                if (result?.success) {
                  window.toast.success(t('chat.save.topic.knowledge.success', { count: result.savedCount }))
                }
              } catch {
                window.toast.error(t('chat.save.topic.knowledge.error.save_failed'))
              }
            }}>
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
            <ContextMenuItem onSelect={() => exportTopicAsMarkdown(topic)}>
              {t('chat.topics.export.md.label')}
            </ContextMenuItem>
          )}
          {exportMenuOptions.markdown_reason && (
            <ContextMenuItem onSelect={() => exportTopicAsMarkdown(topic, true)}>
              {t('chat.topics.export.md.reason')}
            </ContextMenuItem>
          )}
          {exportMenuOptions.docx && (
            <ContextMenuItem
              onSelect={async () => {
                const markdown = await topicToMarkdown(topic)
                void window.api.export.toWord(markdown, removeSpecialCharactersForFileName(topic.name))
              }}>
              {t('chat.topics.export.word')}
            </ContextMenuItem>
          )}
          {exportMenuOptions.notion && (
            <ContextMenuItem onSelect={() => void exportTopicToNotion(topic)}>
              {t('chat.topics.export.notion')}
            </ContextMenuItem>
          )}
          {exportMenuOptions.yuque && (
            <ContextMenuItem
              onSelect={async () => {
                const markdown = await topicToMarkdown(topic)
                void exportMarkdownToYuque(topic.name, markdown)
              }}>
              {t('chat.topics.export.yuque')}
            </ContextMenuItem>
          )}
          {exportMenuOptions.obsidian && (
            <ContextMenuItem
              onSelect={async () => {
                await ObsidianExportPopup.show({ title: topic.name, topic, processingMethod: '3' })
              }}>
              {t('chat.topics.export.obsidian')}
            </ContextMenuItem>
          )}
          {exportMenuOptions.joplin && (
            <ContextMenuItem
              onSelect={async () => {
                const topicMessages = await getTopicMessages(topic.id)
                void exportMarkdownToJoplin(topic.name, topicMessages)
              }}>
              {t('chat.topics.export.joplin')}
            </ContextMenuItem>
          )}
          {exportMenuOptions.siyuan && (
            <ContextMenuItem
              onSelect={async () => {
                const markdown = await topicToMarkdown(topic)
                void exportMarkdownToSiyuan(topic.name, markdown)
              }}>
              {t('chat.topics.export.siyuan')}
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {topicsLength > 1 && !topic.pinned && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => void onDeleteFromMenu(topic)}>
            <Trash2 size={14} />
            {t('common.delete')}
          </ContextMenuItem>
        </>
      )}
    </>
  )
}

const TopicStreamIndicator = ({ topicId }: { topicId: string }) => {
  const { isPending, isFulfilled } = useTopicStreamStatus(topicId)
  if (isPending)
    return (
      <span className="animation-pulse absolute top-[15px] left-[3px] size-[5px] rounded-full bg-(--color-status-warning)" />
    )
  if (isFulfilled)
    return (
      <span className="animation-pulse absolute top-[15px] left-[3px] size-[5px] rounded-full bg-(--color-status-success)" />
    )
  return null
}
