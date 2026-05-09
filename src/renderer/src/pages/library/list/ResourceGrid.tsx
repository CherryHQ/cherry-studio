import { Button, EmptyState, Input } from '@cherrystudio/ui'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Plus, Search, Tag, Upload, X } from 'lucide-react'
import type { FC, MouseEvent, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { RESOURCE_TYPE_META } from '../constants'
import type { ResourceItem, ResourceType, TagItem } from '../types'
import { AssistantCatalogTabRail } from './AssistantCatalogTabRail'
import { FixedCardMenu } from './ResourceCardMenu'
import { AssistantCatalogPresetContent, ResourceCard } from './ResourceCards'
import {
  ASSISTANT_CATALOG_MY_TAB,
  type AssistantCatalogPreset,
  type AssistantCatalogTab,
  getAssistantPresetCatalogKey
} from './useAssistantPresetCatalog'

const GRID_GAP_PX = 12
const RESOURCE_CARD_ROW_ESTIMATE_PX = 164
const ASSISTANT_PRESET_ROW_ESTIMATE_PX = 190

interface AssistantCatalogGridState {
  activeTab: string
  tabs: AssistantCatalogTab[]
  presets: AssistantCatalogPreset[]
  onTabChange: (tabId: string) => void
  onAddPreset: (preset: AssistantCatalogPreset) => Promise<void> | void
  onPreviewPreset: (preset: AssistantCatalogPreset) => void
}

interface Props {
  resources: ResourceItem[]
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
  assistantCatalog
}) => {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const columnCount = useGridColumnCount(scrollRef)
  const [menuState, setMenuState] = useState<{ id: string; x: number; y: number } | null>(null)
  const [showAddTag, setShowAddTag] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [addingPresetKeys, setAddingPresetKeys] = useState<Set<string>>(new Set())
  const showingAssistantCatalogPresets =
    Boolean(assistantCatalog) && assistantCatalog?.activeTab !== ASSISTANT_CATALOG_MY_TAB
  const showTagToolbar =
    activeResourceType === 'assistant' && (!assistantCatalog || assistantCatalog.activeTab === ASSISTANT_CATALOG_MY_TAB)

  const openMenu = useCallback((id: string, e: MouseEvent) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenuState({ id, x: rect.left, y: rect.bottom + 4 })
  }, [])

  const closeMenu = useCallback(() => {
    setMenuState(null)
  }, [])

  const handleAddTag = async () => {
    const trimmed = newTagName.trim()
    if (!trimmed || addingTag) return
    setAddingTag(true)
    try {
      await onAddTag(trimmed)
      setNewTagName('')
      setShowAddTag(false)
    } finally {
      setAddingTag(false)
    }
  }

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
      <div className="flex shrink-0 flex-col border-border/50 border-b">
        <div className="flex items-center gap-2 px-5 py-3">
          <div className="relative max-w-[260px] flex-1">
            <Search size={13} className="-translate-y-1/2 absolute top-1/2 left-2.5 text-muted-foreground/50" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('library.toolbar.search_placeholder')}
              className="h-auto w-full rounded-lg border border-border/40 bg-accent/25 py-1.5 pr-7 pl-7 text-foreground text-sm shadow-none outline-none transition-all placeholder:text-muted-foreground/40 focus-visible:border-primary/40 focus-visible:bg-accent/30 focus-visible:ring-0"
            />
            {search && (
              <Button
                variant="ghost"
                onClick={() => onSearchChange('')}
                className="-translate-y-1/2 absolute top-1/2 right-2 h-auto min-h-0 w-auto p-0 font-normal text-muted-foreground/40 shadow-none transition-colors hover:text-foreground focus-visible:ring-0">
                <X size={10} />
              </Button>
            )}
          </div>

          <div className="flex-1" />

          <div className="flex shrink-0 items-center gap-2">
            {activeResourceType !== 'skill' && (
              <Button
                variant="default"
                onClick={() => onCreate(activeResourceType)}
                className="flex h-auto min-h-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-normal text-xs shadow-none transition-colors focus-visible:ring-0 active:scale-[0.97]">
                <Plus size={11} className="lucide-custom" />
                <span>
                  {t('library.create_menu.create', { type: t(RESOURCE_TYPE_META[activeResourceType].labelKey) })}
                </span>
              </Button>
            )}

            {activeResourceType === 'assistant' && (
              <Button
                variant="ghost"
                onClick={onImportAssistant}
                className="flex h-auto min-h-0 items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 font-normal text-muted-foreground/70 text-xs shadow-none transition-colors hover:border-border/60 hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 active:scale-[0.97]">
                <Upload size={11} />
                <span>{t('assistants.presets.import.action')}</span>
              </Button>
            )}

            {activeResourceType === 'skill' && (
              <Button
                variant="default"
                onClick={() => onCreate('skill')}
                className="flex h-auto min-h-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-normal text-xs shadow-none transition-colors focus-visible:ring-0 active:scale-[0.97]">
                <Upload size={11} className="lucide-custom" />
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
            <Tag size={11} className="mr-0.5 shrink-0 text-muted-foreground/40" />
            {tags.map((tag) => (
              <Button
                variant="ghost"
                key={tag.id}
                onClick={() => onTagFilter(activeTag === tag.name ? null : tag.name)}
                className={`flex h-auto min-h-0 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-[3px] font-normal text-xs shadow-none transition-all focus-visible:ring-0 ${
                  activeTag === tag.name
                    ? 'border-foreground/30 bg-foreground/[0.06] text-foreground hover:border-foreground/40 hover:bg-foreground/[0.08] hover:text-foreground'
                    : 'border-border/30 text-muted-foreground/50 hover:border-border/50 hover:bg-accent/50 hover:text-foreground'
                }`}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                <span>{tag.name}</span>
                <span className="text-muted-foreground/40 text-xs tabular-nums">{tag.count}</span>
              </Button>
            ))}

            {showAddTag ? (
              <div className="flex shrink-0 items-center gap-1">
                <Input
                  autoFocus
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
                  className="h-auto w-[80px] rounded-full border border-border/40 bg-accent/25 px-2 py-[3px] text-foreground text-xs shadow-none outline-none transition-all placeholder:text-muted-foreground/35 focus-visible:border-foreground/40 focus-visible:ring-0 disabled:opacity-50"
                />
                <Button
                  variant="ghost"
                  onClick={() => void handleAddTag()}
                  disabled={addingTag || !newTagName.trim()}
                  className="h-auto min-h-0 w-auto p-0 font-normal text-muted-foreground/40 shadow-none transition-colors hover:text-foreground focus-visible:ring-0 disabled:opacity-40">
                  <Plus size={10} />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                onClick={() => setShowAddTag(true)}
                className="flex h-auto min-h-0 shrink-0 items-center gap-0.5 rounded-full border border-border/40 border-dashed px-2 py-[3px] font-normal text-muted-foreground/40 text-xs shadow-none transition-all hover:border-border/60 hover:bg-accent/50 hover:text-foreground focus-visible:ring-0">
                <Plus size={9} /> {t('library.toolbar.tag_button')}
              </Button>
            )}
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
        {showingAssistantCatalogPresets && assistantCatalog ? (
          <VirtualizedAssistantPresetGrid
            scrollRef={scrollRef}
            columnCount={columnCount}
            presets={assistantCatalog.presets}
            search={search}
            addingPresetKeys={addingPresetKeys}
            onAddPreset={(preset) => void handleAddPreset(preset)}
            onPreviewPreset={assistantCatalog.onPreviewPreset}
          />
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
            onEdit={onEdit}
            onOpenMenu={openMenu}
          />
        )}
      </div>

      {menuState &&
        (() => {
          const resource = resources.find((item) => item.id === menuState.id)
          if (!resource) return null
          return (
            <FixedCardMenu
              key={menuState.id}
              x={menuState.x}
              y={menuState.y}
              resource={resource}
              onClose={closeMenu}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              onExport={onExport}
              onUpdateResourceTags={onUpdateResourceTags}
              allTagNames={allTagNames}
            />
          )
        })()}
    </div>
  )
}

interface VirtualizedResourceGridProps {
  scrollRef: RefObject<HTMLDivElement | null>
  columnCount: number
  resources: ResourceItem[]
  onEdit: (r: ResourceItem) => void
  onOpenMenu: (id: string, event: MouseEvent) => void
}

function VirtualizedResourceGrid({
  scrollRef,
  columnCount,
  resources,
  onEdit,
  onOpenMenu
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
            className="grid gap-3"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
              transform: `translateY(${virtualRow.start}px)`
            }}>
            {row.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} onEdit={onEdit} onOpenMenu={onOpenMenu} />
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
  onAddPreset: (preset: AssistantCatalogPreset) => void
  onPreviewPreset: (preset: AssistantCatalogPreset) => void
}

function VirtualizedAssistantPresetGrid({
  scrollRef,
  columnCount,
  presets,
  search,
  addingPresetKeys,
  onAddPreset,
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
      onAddPreset={onAddPreset}
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
