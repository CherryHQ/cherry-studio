import { Badge, Button, Checkbox, EmptyState, Input, MenuDivider, MenuItem, Separator } from '@cherrystudio/ui'
import { AssistantPresetGroupIcon } from '@renderer/pages/store/assistants/presets/components/AssistantPresetGroupIcon'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { FC, MouseEvent } from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentMutationsById } from '../adapters/agentAdapter'
import { useAssistantMutationsById } from '../adapters/assistantAdapter'
import { useEnsureTags, useSyncEntityTags, useTagList } from '../adapters/tagAdapter'
import { DEFAULT_TAG_COLOR, RESOURCE_TYPE_META } from '../constants'
import type { ResourceItem, ResourceType, TagItem } from '../types'
import {
  ASSISTANT_CATALOG_MY_TAB,
  type AssistantCatalogPreset,
  type AssistantCatalogTab,
  getAssistantPresetCatalogKey
} from './useAssistantPresetCatalog'

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

export function canDuplicateResource(resource: ResourceItem) {
  return resource.type === 'assistant'
}

function getPresetSummary(preset: AssistantCatalogPreset) {
  return (preset.description || preset.prompt || '').replace(/\s+/g, ' ').trim()
}

function AssistantCatalogTabRail({
  tabs,
  activeTab,
  onTabChange
}: Pick<AssistantCatalogGridState, 'tabs' | 'activeTab' | 'onTabChange'>) {
  const { t } = useTranslation()
  const railRef = useRef<HTMLDivElement>(null)
  const scrollRail = (direction: -1 | 1) => {
    railRef.current?.scrollBy({ left: direction * 240, behavior: 'smooth' })
  }

  return (
    <div className="flex items-center gap-1 px-5 pb-3">
      <Button
        variant="ghost"
        aria-label={t('library.assistant_catalog.scroll_left')}
        onClick={() => scrollRail(-1)}
        className="h-8 min-h-0 w-8 shrink-0 rounded-xs p-0 text-muted-foreground/45 shadow-none hover:bg-accent/55 hover:text-foreground focus-visible:ring-0">
        <ChevronLeft size={15} />
      </Button>
      <div className="relative min-w-0 flex-1">
        <div
          ref={railRef}
          className="flex items-center gap-6 overflow-x-auto px-1 pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab) => {
            const active = activeTab === tab.id
            const groupIconName = tab.id === ASSISTANT_CATALOG_MY_TAB ? '我的' : tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`group relative flex h-10 shrink-0 items-center gap-2 px-0 font-normal text-sm outline-none transition-colors focus-visible:ring-0 ${
                  active ? 'text-foreground' : 'text-muted-foreground/55 hover:text-foreground'
                }`}>
                <span className={active ? 'text-foreground/70' : 'text-muted-foreground/55'}>
                  <AssistantPresetGroupIcon groupName={groupIconName} size={15} />
                </span>
                <span>{tab.label}</span>
                <span className="rounded-full bg-accent/70 px-1.5 py-px text-[11px] text-muted-foreground/45 tabular-nums">
                  {tab.count}
                </span>
                <span
                  className={`absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-primary transition-opacity ${
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-35'
                  }`}
                />
              </button>
            )
          })}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent" />
      </div>
      <Button
        variant="ghost"
        aria-label={t('library.assistant_catalog.scroll_right')}
        onClick={() => scrollRail(1)}
        className="h-8 min-h-0 w-8 shrink-0 rounded-xs p-0 text-muted-foreground/45 shadow-none hover:bg-accent/55 hover:text-foreground focus-visible:ring-0">
        <ChevronRight size={15} />
      </Button>
    </div>
  )
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
  const [menuState, setMenuState] = useState<{ id: string; x: number; y: number } | null>(null)
  const [showAddTag, setShowAddTag] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [addingPresetKeys, setAddingPresetKeys] = useState<Set<string>>(new Set())
  const showingAssistantCatalogPresets =
    Boolean(assistantCatalog) && assistantCatalog?.activeTab !== ASSISTANT_CATALOG_MY_TAB

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
      {/* Toolbar */}
      <div className="flex shrink-0 flex-col border-border/50 border-b">
        {/* Row 1: Search + Create */}
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

        {/* Row 2: Tag chips */}
        {(!assistantCatalog || assistantCatalog.activeTab === ASSISTANT_CATALOG_MY_TAB) && (
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
            {/* Add tag (POST /tags; does not bind — newly-created tags appear only after binding) */}
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
        {showingAssistantCatalogPresets && assistantCatalog ? (
          <AssistantCatalogPresetContent
            presets={assistantCatalog.presets}
            search={search}
            addingPresetKeys={addingPresetKeys}
            onAddPreset={(preset) => void handleAddPreset(preset)}
            onPreviewPreset={assistantCatalog.onPreviewPreset}
          />
        ) : resources.length === 0 ? (
          <EmptyState
            preset={search ? 'no-result' : 'no-resource'}
            title={search ? t('library.empty_state.no_match_title') : t('library.empty_state.empty_title')}
            description={
              search ? t('library.empty_state.no_match_description') : t('library.empty_state.empty_description')
            }
            className="py-20"
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {resources.map((r, i) => (
              <GridCard key={r.id} resource={r} index={i} onEdit={onEdit} onOpenMenu={openMenu} />
            ))}
          </div>
        )}
      </div>

      {/* Fixed context menu portal */}
      <AnimatePresence>
        {menuState &&
          (() => {
            const r = resources.find((x) => x.id === menuState.id)
            if (!r) return null
            return (
              <FixedCardMenu
                key={menuState.id}
                x={menuState.x}
                y={menuState.y}
                resource={r}
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
      </AnimatePresence>
    </div>
  )
}

interface AssistantCatalogPresetContentProps {
  presets: AssistantCatalogPreset[]
  search: string
  addingPresetKeys: ReadonlySet<string>
  onAddPreset: (preset: AssistantCatalogPreset) => void
  onPreviewPreset: (preset: AssistantCatalogPreset) => void
}

function AssistantCatalogPresetContent({
  presets,
  search,
  addingPresetKeys,
  onAddPreset,
  onPreviewPreset
}: AssistantCatalogPresetContentProps) {
  const { t } = useTranslation()

  if (presets.length === 0) {
    return (
      <EmptyState
        preset={search ? 'no-result' : 'no-resource'}
        title={search ? t('library.assistant_catalog.no_match_title') : t('library.assistant_catalog.empty_title')}
        description={
          search
            ? t('library.assistant_catalog.no_match_description')
            : t('library.assistant_catalog.empty_description')
        }
        className="py-20"
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {presets.map((preset, index) => {
        const presetKey = getAssistantPresetCatalogKey(preset)
        return (
          <AssistantPresetGridCard
            key={`${presetKey}-${index}`}
            preset={preset}
            index={index}
            adding={addingPresetKeys.has(presetKey)}
            onAdd={onAddPreset}
            onPreview={onPreviewPreset}
          />
        )
      })}
    </div>
  )
}

interface AssistantPresetCardProps {
  preset: AssistantCatalogPreset
  index: number
  adding: boolean
  onAdd: (preset: AssistantCatalogPreset) => void
  onPreview: (preset: AssistantCatalogPreset) => void
}

function AssistantPresetGridCard({ preset, index, adding, onAdd, onPreview }: AssistantPresetCardProps) {
  const { t } = useTranslation()
  const summary = getPresetSummary(preset)
  const groups = (preset.group || []).slice(0, 3)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.02 }}
      className="group flex min-h-[178px] flex-col rounded-xs border border-border/40 bg-card p-4 transition-all duration-200 hover:border-border/60 hover:shadow-black/[0.035] hover:shadow-lg"
      onClick={() => onPreview(preset)}>
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xs bg-accent/55 text-base">
          {preset.emoji || '🤖'}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-foreground text-sm">{preset.name}</h4>
          <div className="mt-1 flex min-h-5 flex-wrap items-center gap-1">
            {groups.map((group) => (
              <Badge
                key={group}
                variant="secondary"
                className="border-0 bg-accent/60 px-1.5 py-px text-muted-foreground/65 text-xs">
                {group}
              </Badge>
            ))}
          </div>
        </div>
      </div>
      <p className="line-clamp-3 min-h-[4.5em] flex-1 text-muted-foreground/70 text-xs leading-relaxed">{summary}</p>
      <div className="mt-4 flex items-center justify-end gap-1.5">
        <Button
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation()
            onPreview(preset)
          }}
          className="flex h-7 min-h-0 items-center gap-1 rounded-lg px-2.5 font-normal text-muted-foreground/60 text-xs shadow-none transition-colors hover:bg-accent/55 hover:text-foreground focus-visible:ring-0">
          <Eye size={12} />
          {t('library.assistant_catalog.preview')}
        </Button>
        <Button
          variant="default"
          disabled={adding}
          onClick={(e) => {
            e.stopPropagation()
            onAdd(preset)
          }}
          className="flex h-7 min-h-0 items-center gap-1 rounded-lg px-2.5 font-normal text-xs shadow-none transition-colors focus-visible:ring-0">
          {t('library.assistant_catalog.add')}
        </Button>
      </div>
    </motion.div>
  )
}

interface CardItemProps {
  resource: ResourceItem
  index: number
  onEdit: (r: ResourceItem) => void
  onOpenMenu: (id: string, e: MouseEvent) => void
}

function GridCard({ resource: r, index, onEdit, onOpenMenu }: CardItemProps) {
  const cfg = RESOURCE_TYPE_META[r.type]
  // Skills get the type-specific tinted background to match the menu icon;
  // assistants / agents fall back to the neutral accent block.
  const useTypedAvatarBg = r.type === 'skill'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.02 }}
      whileHover={{ y: -2 }}
      className="group relative cursor-pointer rounded-xs border border-border/40 bg-card transition-all duration-200 hover:border-border/60 hover:shadow-black/[0.04] hover:shadow-lg"
      onClick={() => onEdit(r)}>
      <div className="p-4">
        <div className="mb-3 flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xs text-base ${
              useTypedAvatarBg ? cfg.color : 'bg-accent/50'
            }`}>
            {r.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h4 className="truncate text-foreground text-sm">{r.name}</h4>
            </div>
            {r.model && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-muted-foreground/50 text-xs">{r.model}</span>
              </div>
            )}
          </div>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => onOpenMenu(r.id, e)}
              className="flex h-6 min-h-0 w-6 items-center justify-center rounded-3xs p-0 font-normal text-muted-foreground/40 opacity-0 shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 group-hover:opacity-100">
              <MoreHorizontal size={12} />
            </Button>
          </div>
        </div>
        <p className="mb-3 line-clamp-2 min-h-[2lh] text-muted-foreground/70 text-xs leading-relaxed">
          {r.description}
        </p>
        <div className="flex min-h-5 items-center justify-end">
          <div className="flex items-center gap-1.5">
            {r.tags.slice(0, 2).map((t, i) => (
              <Badge
                key={`${t}-${i}`}
                variant="secondary"
                className="border-0 bg-accent/50 px-1.5 py-px text-muted-foreground/60 text-xs">
                {t}
              </Badge>
            ))}
            {r.tags.length > 2 && <span className="text-muted-foreground/50 text-xs">+{r.tags.length - 2}</span>}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

interface FixedCardMenuProps {
  x: number
  y: number
  resource: ResourceItem
  onClose: () => void
  onEdit: (r: ResourceItem) => void
  onDuplicate: (r: ResourceItem) => void
  onDelete: (r: ResourceItem) => void
  onExport: (r: ResourceItem) => void
  onUpdateResourceTags: (resourceId: string, tags: string[]) => void
  allTagNames: string[]
}

export function FixedCardMenu({
  x,
  y,
  resource,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
  onExport,
  onUpdateResourceTags,
  allTagNames
}: FixedCardMenuProps) {
  const { t } = useTranslation()
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [localTags, setLocalTags] = useState<string[]>(resource.tags)
  const [tagInput, setTagInput] = useState('')
  const [bindingError, setBindingError] = useState<string | null>(null)
  const [bindingPending, setBindingPending] = useState(false)
  const bindingPendingRef = useRef(false)

  // Assistant / agent tag binding flows through the resource's own PATCH so
  // row updates and tag ids land together. Skills have no editable row fields
  // in DataApi, so they use the generic entity_tag endpoint.
  const { ensureTags } = useEnsureTags()
  const { updateAssistant } = useAssistantMutationsById(resource.id)
  const { updateAgent } = useAgentMutationsById(resource.id)
  const { syncEntityTags } = useSyncEntityTags()
  const canBindTags = resource.type === 'assistant' || resource.type === 'agent' || resource.type === 'skill'

  // Backend-assigned tag color (random-from-palette at POST time) — look up so
  // chip dots render consistently across Row 2, card menu, and BasicSection.
  const tagList = useTagList()
  const colorFor = (name: string): string => tagList.tags.find((t) => t.name === name)?.color ?? DEFAULT_TAG_COLOR

  const menuW = 150
  const menuH = 200
  const subMenuW = 170
  const clampX = Math.max(8, Math.min(x - menuW, window.innerWidth - menuW - 8))
  const clampY = Math.min(y, window.innerHeight - menuH - 8)
  const openLeft = clampX + menuW + subMenuW + 8 > window.innerWidth

  const persistTags = useCallback(
    async (nextNames: string[], previousNames: string[]) => {
      if (!canBindTags) return
      if (bindingPendingRef.current) return
      bindingPendingRef.current = true
      setBindingPending(true)
      try {
        const tags = await ensureTags(nextNames)
        const tagIds = tags.map((tag) => tag.id)
        if (resource.type === 'assistant') {
          await updateAssistant({ tagIds })
        } else if (resource.type === 'agent') {
          await updateAgent({ tagIds })
        } else if (resource.type === 'skill') {
          await syncEntityTags('skill', resource.id, tagIds)
        }
        onUpdateResourceTags(resource.id, nextNames)
      } catch (e) {
        // Roll back optimistic state on failure.
        setLocalTags(previousNames)
        setBindingError(e instanceof Error ? e.message : t('library.tag_sync_failed'))
      } finally {
        bindingPendingRef.current = false
        setBindingPending(false)
      }
    },
    [
      canBindTags,
      ensureTags,
      updateAssistant,
      updateAgent,
      syncEntityTags,
      onUpdateResourceTags,
      resource.id,
      resource.type,
      t
    ]
  )

  const toggleTag = (tag: string) => {
    if (bindingPendingRef.current) return
    const prev = localTags
    const next = prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    setLocalTags(next)
    setBindingError(null)
    void persistTags(next, prev)
  }

  const addNewTag = () => {
    if (bindingPendingRef.current) return
    const t = tagInput.trim()
    if (!t || localTags.includes(t)) {
      setTagInput('')
      return
    }
    const prev = localTags
    const next = [...prev, t]
    setLocalTags(next)
    setTagInput('')
    setBindingError(null)
    void persistTags(next, prev)
  }

  const subMenuPos = openLeft ? 'right-full top-0 mr-1' : 'left-full top-0 ml-1'

  return (
    <div>
      <div className="fixed inset-0 z-[500]" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.1 }}
        className="fixed z-[501] min-w-[140px] rounded-xs border border-border/30 bg-popover p-1 shadow-xl"
        style={{ left: clampX, top: clampY }}>
        <MenuItem
          variant="ghost"
          size="sm"
          icon={<Pencil size={10} />}
          label={t('common.edit')}
          onClick={() => {
            onEdit(resource)
            onClose()
          }}
        />

        {/* Tag picker — assistant / agent / skill. */}
        {canBindTags && (
          <div className="relative">
            <MenuItem
              variant="ghost"
              size="sm"
              active={showTagPicker}
              icon={<Tag size={10} />}
              label={t('library.action.manage_tags')}
              suffix={
                <>
                  {localTags.length > 0 && (
                    <span className="text-muted-foreground/40 text-xs tabular-nums">{localTags.length}</span>
                  )}
                  <ChevronDown size={8} className={`transition-transform ${showTagPicker ? 'rotate-180' : ''}`} />
                </>
              }
              onClick={() => setShowTagPicker(!showTagPicker)}
            />
            {bindingError && <p className="px-2.5 py-1 text-destructive/80 text-xs">{bindingError}</p>}
            {showTagPicker && (
              <div
                className={`absolute ${subMenuPos} flex max-h-[260px] min-w-[160px] flex-col rounded-xs border border-border/30 bg-popover p-1 shadow-xl`}>
                <div className="mb-0.5 flex items-center gap-1 px-2 py-1">
                  <Input
                    autoFocus
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addNewTag()
                    }}
                    disabled={bindingPending}
                    placeholder={t('library.tag_picker.placeholder')}
                    className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-foreground text-xs shadow-none outline-none placeholder:text-muted-foreground/30 focus-visible:ring-0 disabled:opacity-50"
                  />
                  {tagInput.trim() && (
                    <Button
                      variant="ghost"
                      onClick={addNewTag}
                      disabled={bindingPending}
                      className="h-auto min-h-0 w-auto p-0 font-normal text-muted-foreground/30 shadow-none transition-colors hover:text-foreground focus-visible:ring-0 disabled:opacity-40">
                      <Plus size={10} />
                    </Button>
                  )}
                </div>
                <Separator className="mx-1 mb-0.5 bg-border/15" />
                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[2px]">
                  {allTagNames.length === 0 && !tagInput.trim() && (
                    <p className="px-2.5 py-2 text-center text-muted-foreground/40 text-xs">
                      {t('library.tag_picker.no_tags')}
                    </p>
                  )}
                  {allTagNames.map((tag) => {
                    const checked = localTags.includes(tag)
                    return (
                      <label
                        key={tag}
                        className={`flex w-full items-center gap-2 rounded-3xs px-2.5 py-[5px] text-muted-foreground/60 text-xs transition-colors ${
                          bindingPending
                            ? 'cursor-not-allowed opacity-60'
                            : 'cursor-pointer hover:bg-accent/50 hover:text-foreground'
                        }`}>
                        <Checkbox
                          size="sm"
                          checked={checked}
                          disabled={bindingPending}
                          onCheckedChange={() => toggleTag(tag)}
                          className="size-3.5 rounded-4xs border-border/30 bg-transparent shadow-none transition-colors hover:bg-transparent focus-visible:ring-0 data-[state=checked]:border-primary/70 data-[state=checked]:bg-primary/70 data-[state=checked]:text-primary-foreground [&_[data-slot=checkbox-indicator]_svg]:size-2"
                        />
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: colorFor(tag) }}
                        />
                        <span className="flex-1 truncate text-left">{tag}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {canDuplicateResource(resource) && (
          <MenuItem
            variant="ghost"
            size="sm"
            icon={<Copy size={10} />}
            label={t('library.action.duplicate')}
            onClick={() => {
              onDuplicate(resource)
              onClose()
            }}
          />
        )}
        {resource.type === 'assistant' && (
          <MenuItem
            variant="ghost"
            size="sm"
            icon={<Download size={10} />}
            label={t('assistants.presets.export.agent')}
            onClick={() => {
              onExport(resource)
              onClose()
            }}
          />
        )}
        <MenuDivider className="mx-1 my-0.5 bg-border/15" />
        <MenuItem
          variant="ghost"
          size="sm"
          icon={<Trash2 size={10} />}
          label={resource.type === 'skill' ? t('library.action.uninstall') : t('common.delete')}
          onClick={() => {
            onDelete(resource)
            onClose()
          }}
          className="text-destructive/70 hover:bg-destructive/10 hover:text-destructive data-[active=true]:bg-destructive/10 data-[active=true]:text-destructive"
        />
      </motion.div>
    </div>
  )
}

export default ResourceGrid
