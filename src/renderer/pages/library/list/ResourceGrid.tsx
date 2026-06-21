import {
  Button,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Skeleton
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useDeleteTag, useRenameTag } from '@renderer/hooks/useTags'
import type { Tag as BackendTag } from '@shared/data/types/tag'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Tag, Trash2, Upload, X } from 'lucide-react'
import type { FC, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DEFAULT_TAG_COLOR, RESOURCE_TYPE_META } from '../constants'
import type { ResourceItem, ResourceType, TagItem } from '../types'
import { AssistantCatalogTabRail } from './AssistantCatalogTabRail'
import { AssistantCatalogPresetContent, ResourceCard } from './ResourceCards'
import {
  ASSISTANT_CATALOG_MY_TAB,
  type AssistantCatalogPreset,
  type AssistantCatalogTab,
  getAssistantPresetCatalogKey
} from './useAssistantPresetCatalog'

const logger = loggerService.withContext('ResourceGrid')

const GRID_GAP_PX = 12
const RESOURCE_CARD_ROW_ESTIMATE_PX = 92
const ASSISTANT_PRESET_ROW_ESTIMATE_PX = 144

interface AssistantCatalogGridState {
  activeTab: string
  tabs: AssistantCatalogTab[]
  presets: AssistantCatalogPreset[]
  addedAssistantPresets: Readonly<Record<string, string>>
  onTabChange: (tabId: string) => void
  onAddPreset: (preset: AssistantCatalogPreset) => Promise<void> | void
  onOpenPresetChat: (assistantId: string) => void
  onPreviewPreset: (preset: AssistantCatalogPreset) => void
}

interface Props {
  resources: ResourceItem[]
  isLoading?: boolean
  activeResourceType: ResourceType
  search: string
  onSearchChange: (v: string) => void
  onEdit: (r: ResourceItem) => void
  onDuplicate: (r: ResourceItem) => void
  onDelete: (r: ResourceItem) => void
  onExport: (r: ResourceItem) => void
  onCreate: (type: ResourceType) => void
  onImportAssistant: () => void
  tags: TagItem[]
  activeTag: string | null
  onTagFilter: (tagName: string | null) => void
  /** Create a new tag (POST /tags). Does not bind the tag to any resource. */
  onAddTag: (tagName: string) => Promise<void> | void
  /** Replace the tag-name set for a single resource. Caller handles ensure-tag + bind. */
  onUpdateResourceTags: (resourceId: string, tags: string[]) => Promise<void> | void
  allTagNames: string[]
  /** Full backend tag records (id + name + color). Distinct from `allTagNames` (names only). */
  allTags: BackendTag[]
  assistantCatalog?: AssistantCatalogGridState
}

function getGridColumnCount(width: number) {
  if (width >= 1024) return 3
  if (width >= 640) return 2
  return 1
}

function useGridColumnCount(scrollRef: RefObject<HTMLDivElement | null>) {
  const [gridState, setGridState] = useState({ columnCount: 1, measured: false })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const update = () => {
      const columnCount = getGridColumnCount(el.clientWidth)
      setGridState((prev) =>
        prev.measured && prev.columnCount === columnCount ? prev : { columnCount, measured: true }
      )
    }

    update()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }

    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollRef])

  return gridState.columnCount
}

export const ResourceGrid: FC<Props> = ({
  resources,
  isLoading = false,
  activeResourceType,
  search,
  onSearchChange,
  onEdit,
  onDuplicate,
  onDelete,
  onExport,
  onCreate,
  onImportAssistant,
  tags,
  activeTag,
  onTagFilter,
  onAddTag,
  onUpdateResourceTags,
  allTagNames,
  allTags,
  assistantCatalog
}) => {
  const { t } = useTranslation()
  const { renameTag } = useRenameTag()
  const { deleteTag } = useDeleteTag()
  const scrollRef = useRef<HTMLDivElement>(null)
  const columnCount = useGridColumnCount(scrollRef)
  const [showAddTag, setShowAddTag] = useState(false)
  const [showAllTags, setShowAllTags] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [addingPresetKeys, setAddingPresetKeys] = useState<Set<string>>(new Set())
  const [renamingTag, setRenamingTag] = useState<TagItem | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deletingTag, setDeletingTag] = useState<TagItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const showingAssistantCatalogPresets =
    Boolean(assistantCatalog) && assistantCatalog?.activeTab !== ASSISTANT_CATALOG_MY_TAB
  const showTagToolbar =
    activeResourceType === 'assistant' && (!assistantCatalog || assistantCatalog.activeTab === ASSISTANT_CATALOG_MY_TAB)
  // This "unused" set is scoped to the assistant library: today user-managed
  // resource tags are only bound to assistants. If other entity types start
  // sharing `/tags`, replace this client-side difference with server-provided
  // global usage/unused data before exposing destructive actions.
  const unusedTags = useMemo(() => {
    const usedNames = new Set(tags.map((tag) => tag.name))
    return allTags
      .filter((tag) => !usedNames.has(tag.name))
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color ?? DEFAULT_TAG_COLOR,
        count: 0
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [allTags, tags])
  const visibleTags = showAllTags ? [...tags, ...unusedTags] : tags

  const handleAddTag = async () => {
    const trimmed = newTagName.trim()
    if (!trimmed || addingTag) return
    setAddingTag(true)
    try {
      await onAddTag(trimmed)
      setNewTagName('')
      setShowAddTag(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('library.tag_sync_failed')
      window.toast.error(message)
      logger.error('Failed to create tag', error instanceof Error ? error : new Error(String(error)), {
        name: trimmed
      })
    } finally {
      setAddingTag(false)
    }
  }

  const handleOpenRenameTag = useCallback((tag: TagItem) => {
    setRenamingTag(tag)
    setRenameValue(tag.name)
  }, [])

  const handleRenameTag = useCallback(async () => {
    const tag = renamingTag
    const nextName = renameValue.trim()
    if (!tag || renaming || !nextName) return

    if (nextName === tag.name) {
      setRenamingTag(null)
      return
    }

    setRenaming(true)
    try {
      const updated = await renameTag(tag.id, nextName)
      if (activeTag === tag.name) onTagFilter(updated.name)
      setRenamingTag(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('library.tag_sync_failed')
      window.toast.error(message)
      logger.error('Failed to rename tag', error instanceof Error ? error : new Error(String(error)), {
        id: tag.id,
        name: tag.name,
        nextName
      })
    } finally {
      setRenaming(false)
    }
  }, [activeTag, onTagFilter, renameTag, renameValue, renaming, renamingTag, t])

  const handleConfirmDeleteTag = useCallback(async () => {
    const tag = deletingTag
    if (!tag || deleting) return

    setDeleting(true)
    try {
      await deleteTag(tag.id)
      if (activeTag === tag.name) onTagFilter(null)
      setDeletingTag(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('library.tag_sync_failed')
      window.toast.error(message)
      logger.error('Failed to delete tag', error instanceof Error ? error : new Error(String(error)), {
        id: tag.id,
        name: tag.name
      })
    } finally {
      setDeleting(false)
    }
  }, [activeTag, deleteTag, deleting, deletingTag, onTagFilter, t])

  const handleAddPreset = useCallback(
    async (preset: AssistantCatalogPreset) => {
      if (!assistantCatalog) return

      const presetKey = getAssistantPresetCatalogKey(preset)
      if (addingPresetKeys.has(presetKey)) return

      setAddingPresetKeys((prev) => new Set(prev).add(presetKey))
      try {
        await assistantCatalog.onAddPreset(preset)
      } finally {
        setAddingPresetKeys((prev) => {
          const next = new Set(prev)
          next.delete(presetKey)
          return next
        })
      }
    },
    [addingPresetKeys, assistantCatalog]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col border-border-muted border-b">
        <div className="flex items-center gap-2 px-5 py-3">
          <div className="relative max-w-64 flex-1">
            <Search size={14} className="-translate-y-1/2 absolute top-1/2 left-2.5 text-foreground-muted" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('library.toolbar.search_placeholder')}
              className="h-8 rounded-md border-input bg-background pr-8 pl-8 text-sm placeholder:text-foreground-muted"
            />
            {search && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.clear')}
                onClick={() => onSearchChange('')}
                className="-translate-y-1/2 absolute top-1/2 right-1 size-6 text-foreground-muted hover:text-foreground">
                <X size={12} />
              </Button>
            )}
          </div>

          <div className="flex-1" />

          <div className="flex shrink-0 items-center gap-2">
            {activeResourceType !== 'skill' && (
              <Button variant="default" size="sm" onClick={() => onCreate(activeResourceType)} className="shrink-0">
                <Plus size={12} className="lucide-custom" />
                <span>
                  {t('library.create_menu.create', { type: t(RESOURCE_TYPE_META[activeResourceType].labelKey) })}
                </span>
              </Button>
            )}

            {activeResourceType === 'assistant' && (
              <Button variant="outline" size="sm" onClick={onImportAssistant} className="shrink-0">
                <Upload size={12} />
                <span>{t('assistants.presets.import.action')}</span>
              </Button>
            )}

            {activeResourceType === 'skill' && (
              <Button variant="default" size="sm" onClick={() => onCreate('skill')} className="shrink-0">
                <Upload size={12} className="lucide-custom" />
                <span>{t('library.create_menu.import', { type: t(RESOURCE_TYPE_META.skill.labelKey) })}</span>
              </Button>
            )}
          </div>
        </div>

        {assistantCatalog && (
          <AssistantCatalogTabRail
            tabs={assistantCatalog.tabs}
            activeTab={assistantCatalog.activeTab}
            onTabChange={assistantCatalog.onTabChange}
          />
        )}

        {showTagToolbar && (
          <div className="flex items-center gap-1.5 overflow-x-auto px-5 pb-3 [&::-webkit-scrollbar]:h-0">
            <Tag size={12} className="mr-0.5 shrink-0 text-foreground-muted" />
            {visibleTags.map((tag) => (
              <ContextMenu key={tag.id}>
                <ContextMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    onClick={() => onTagFilter(activeTag === tag.name ? null : tag.name)}
                    className={`flex h-6 min-h-0 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs shadow-none ${
                      activeTag === tag.name
                        ? 'border-border-active bg-secondary text-foreground hover:bg-secondary-hover hover:text-foreground'
                        : 'border-border-subtle text-foreground-muted hover:border-border-hover hover:bg-accent hover:text-foreground'
                    }`}>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span>{tag.name}</span>
                    <span className="text-foreground-muted text-xs tabular-nums">{tag.count}</span>
                  </Button>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-32">
                  <ContextMenuItem onSelect={() => handleOpenRenameTag(tag)}>
                    <ContextMenuItemContent icon={<Pencil size={12} />}>{t('common.rename')}</ContextMenuItemContent>
                  </ContextMenuItem>
                  <ContextMenuItem variant="destructive" onSelect={() => setDeletingTag(tag)}>
                    <ContextMenuItemContent icon={<Trash2 size={12} />}>
                      {t('assistants.tags.delete')}
                    </ContextMenuItemContent>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}

            {unusedTags.length > 0 && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('library.toolbar.all_tags')}
                title={t('library.toolbar.all_tags')}
                onClick={() => setShowAllTags((value) => !value)}
                className="size-6 shrink-0 rounded-full text-foreground-muted hover:bg-accent hover:text-foreground">
                {showAllTags ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
              </Button>
            )}

            {showAddTag ? (
              <div className="flex shrink-0 items-center gap-1">
                <Input
                  autoFocus
                  maxLength={64}
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleAddTag()
                    if (e.key === 'Escape') {
                      setShowAddTag(false)
                      setNewTagName('')
                    }
                  }}
                  onBlur={() => {
                    if (!newTagName.trim() && !addingTag) setShowAddTag(false)
                  }}
                  disabled={addingTag}
                  placeholder={t('library.toolbar.add_tag_placeholder')}
                  className="h-6 w-20 rounded-full border-input bg-background px-2 text-xs placeholder:text-foreground-muted"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void handleAddTag()}
                  disabled={addingTag || !newTagName.trim()}
                  className="size-6 text-foreground-muted hover:text-foreground">
                  <Plus size={12} />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                onClick={() => setShowAddTag(true)}
                className="flex h-6 min-h-0 shrink-0 items-center gap-1 rounded-full border border-border-muted border-dashed px-2 text-foreground-muted text-xs shadow-none hover:border-border-hover hover:bg-accent hover:text-foreground">
                <Plus size={11} /> {t('library.toolbar.tag_button')}
              </Button>
            )}
          </div>
        )}
        <Dialog
          open={Boolean(renamingTag)}
          onOpenChange={(open) => {
            if (!open && !renaming) setRenamingTag(null)
          }}>
          <DialogContent className="max-w-sm rounded-xl">
            <DialogHeader>
              <DialogTitle>{t('common.rename')}</DialogTitle>
            </DialogHeader>
            <Input
              autoFocus
              maxLength={64}
              aria-label={t('common.rename')}
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleRenameTag()
                if (event.key === 'Escape' && !renaming) setRenamingTag(null)
              }}
              disabled={renaming}
              className="h-9 rounded-md border-input bg-background"
            />
            <DialogFooter>
              <Button variant="outline" size="sm" disabled={renaming} onClick={() => setRenamingTag(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                loading={renaming}
                disabled={!renameValue.trim()}
                onClick={() => void handleRenameTag()}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={Boolean(deletingTag)}
          onOpenChange={(open) => {
            if (!open && !deleting) setDeletingTag(null)
          }}
          title={t('assistants.tags.delete')}
          description={t('assistants.tags.deleteConfirm')}
          confirmText={t('common.delete')}
          cancelText={t('common.cancel')}
          destructive
          confirmLoading={deleting}
          onConfirm={handleConfirmDeleteTag}
        />
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-muted [&::-webkit-scrollbar]:w-1">
        {showingAssistantCatalogPresets && assistantCatalog ? (
          <VirtualizedAssistantPresetGrid
            scrollRef={scrollRef}
            columnCount={columnCount}
            presets={assistantCatalog.presets}
            search={search}
            addingPresetKeys={addingPresetKeys}
            addedAssistantPresets={assistantCatalog.addedAssistantPresets}
            onAddPreset={(preset) => void handleAddPreset(preset)}
            onOpenPresetChat={assistantCatalog.onOpenPresetChat}
            onPreviewPreset={assistantCatalog.onPreviewPreset}
          />
        ) : isLoading ? (
          <ResourceGridLoadingState columnCount={columnCount} />
        ) : resources.length === 0 ? (
          <EmptyState
            preset={search ? 'no-result' : 'no-resource'}
            title={search ? t('library.empty_state.no_match_title') : t('library.empty_state.title')}
            description={search ? t('library.empty_state.no_match_description') : t('library.empty_state.description')}
            className="py-20"
          />
        ) : (
          <VirtualizedResourceGrid
            scrollRef={scrollRef}
            columnCount={columnCount}
            resources={resources}
            allTagNames={allTagNames}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onEdit={onEdit}
            onExport={onExport}
            onUpdateResourceTags={onUpdateResourceTags}
          />
        )}
      </div>
    </div>
  )
}

function ResourceGridLoadingState({ columnCount }: { columnCount: number }) {
  const count = Math.max(columnCount, 1) * 4

  return (
    <div
      className="grid gap-3"
      data-testid="resource-grid-loading"
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-lg border border-border-subtle bg-card p-3.5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

interface VirtualizedResourceGridProps {
  scrollRef: RefObject<HTMLDivElement | null>
  columnCount: number
  resources: ResourceItem[]
  allTagNames: string[]
  onDelete: (r: ResourceItem) => void
  onDuplicate: (r: ResourceItem) => void
  onEdit: (r: ResourceItem) => void
  onExport: (r: ResourceItem) => void
  onUpdateResourceTags: (resourceId: string, tags: string[]) => void
}

function VirtualizedResourceGrid({
  scrollRef,
  columnCount,
  resources,
  allTagNames,
  onDelete,
  onDuplicate,
  onEdit,
  onExport,
  onUpdateResourceTags
}: VirtualizedResourceGridProps) {
  const rows = useMemo(() => {
    const nextRows: ResourceItem[][] = []
    for (let i = 0; i < resources.length; i += columnCount) {
      nextRows.push(resources.slice(i, i + columnCount))
    }
    return nextRows
  }, [columnCount, resources])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => RESOURCE_CARD_ROW_ESTIMATE_PX + GRID_GAP_PX,
    overscan: 4
  })

  return (
    <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index] ?? []
        return (
          <div
            key={virtualRow.key}
            ref={rowVirtualizer.measureElement}
            data-index={virtualRow.index}
            className="grid gap-3 pb-3"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
              transform: `translateY(${virtualRow.start}px)`
            }}>
            {row.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                allTagNames={allTagNames}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onEdit={onEdit}
                onExport={onExport}
                onUpdateResourceTags={onUpdateResourceTags}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

interface VirtualizedAssistantPresetGridProps {
  scrollRef: RefObject<HTMLDivElement | null>
  columnCount: number
  presets: AssistantCatalogPreset[]
  search: string
  addingPresetKeys: ReadonlySet<string>
  addedAssistantPresets: Readonly<Record<string, string>>
  onAddPreset: (preset: AssistantCatalogPreset) => void
  onOpenPresetChat: (assistantId: string) => void
  onPreviewPreset: (preset: AssistantCatalogPreset) => void
}

function VirtualizedAssistantPresetGrid({
  scrollRef,
  columnCount,
  presets,
  search,
  addingPresetKeys,
  addedAssistantPresets,
  onAddPreset,
  onOpenPresetChat,
  onPreviewPreset
}: VirtualizedAssistantPresetGridProps) {
  const rows = useMemo(() => {
    const nextRows: AssistantCatalogPreset[][] = []
    for (let i = 0; i < presets.length; i += columnCount) {
      nextRows.push(presets.slice(i, i + columnCount))
    }
    return nextRows
  }, [columnCount, presets])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ASSISTANT_PRESET_ROW_ESTIMATE_PX + GRID_GAP_PX,
    overscan: 4
  })

  return (
    <AssistantCatalogPresetContent
      presets={presets}
      search={search}
      addingPresetKeys={addingPresetKeys}
      addedAssistantPresets={addedAssistantPresets}
      onAddPreset={onAddPreset}
      onOpenPresetChat={onOpenPresetChat}
      onPreviewPreset={onPreviewPreset}
      virtualRows={rowVirtualizer.getVirtualItems()}
      totalHeight={rowVirtualizer.getTotalSize()}
      measureRow={rowVirtualizer.measureElement}
      rows={rows}
      columnCount={columnCount}
    />
  )
}

export default ResourceGrid
