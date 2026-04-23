import {
  Badge,
  Button,
  ButtonGroup,
  Checkbox,
  EmptyState,
  Input,
  MenuDivider,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Switch
} from '@cherrystudio/ui'
import type { TFunction } from 'i18next'
import {
  ArrowUpDown,
  ChevronDown,
  Clock,
  Copy,
  Download,
  LayoutGrid,
  List,
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
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAssistantMutationsById } from '../adapters/assistantAdapter'
import { useEnsureTags, useTagList } from '../adapters/tagAdapter'
import { DEFAULT_TAG_COLOR, RESOURCE_TYPE_META, SORT_META, SORT_ORDER } from '../constants'
import type { ResourceItem, ResourceType, SortKey, TagItem, ViewMode } from '../types'

interface Props {
  resources: ResourceItem[]
  viewMode: ViewMode
  sortKey: SortKey
  search: string
  onSearchChange: (v: string) => void
  onViewModeChange: (v: ViewMode) => void
  onSortKeyChange: (k: SortKey) => void
  onEdit: (r: ResourceItem) => void
  onDuplicate: (r: ResourceItem) => void
  onDelete: (r: ResourceItem) => void
  onExport: (r: ResourceItem) => void
  onToggle: (id: string) => void
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
}

export function canDuplicateResource(resource: ResourceItem) {
  return resource.type === 'assistant'
}

function timeAgo(t: TFunction, dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('library.time_ago.just_now')
  if (mins < 60) return t('library.time_ago.minutes', { count: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('library.time_ago.hours', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('library.time_ago.days', { count: days })
  return t('library.time_ago.months', { count: Math.floor(days / 30) })
}

export const ResourceGrid: FC<Props> = ({
  resources,
  viewMode,
  sortKey,
  search,
  onSearchChange,
  onViewModeChange,
  onSortKeyChange,
  onEdit,
  onDuplicate,
  onDelete,
  onExport,
  onToggle,
  onCreate,
  onImportAssistant,
  tags,
  activeTag,
  onTagFilter,
  onAddTag,
  onUpdateResourceTags,
  allTagNames
}) => {
  const { t } = useTranslation()
  const [showSort, setShowSort] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [menuState, setMenuState] = useState<{ id: string; x: number; y: number } | null>(null)
  const [showAddTag, setShowAddTag] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [addingTag, setAddingTag] = useState(false)

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-col border-border/40 border-b">
        {/* Row 1: Search + Sort + View + Create */}
        <div className="flex items-center gap-2 px-5 py-3">
          <div className="relative max-w-[260px] flex-1">
            <Search size={13} className="-translate-y-1/2 absolute top-1/2 left-2.5 text-muted-foreground/50" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('library.toolbar.search_placeholder')}
              className="h-auto w-full rounded-3xs border border-border/40 bg-accent/20 py-1.5 pr-7 pl-7 text-[11px] text-foreground shadow-none outline-none transition-all placeholder:text-muted-foreground/40 focus-visible:border-primary/40 focus-visible:bg-accent/30 focus-visible:ring-0 md:text-[11px]"
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

          {/* Sort */}
          <Popover
            open={showSort}
            onOpenChange={(open) => {
              setShowSort(open)
              if (open) setShowCreate(false)
            }}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                className={`flex h-auto min-h-0 items-center gap-1.5 rounded-3xs border px-2.5 py-1.5 font-normal text-[10px] shadow-none transition-all focus-visible:ring-0 ${
                  showSort
                    ? 'border-primary/30 bg-accent/60 text-foreground'
                    : 'border-border/40 text-muted-foreground/60 hover:border-border/60 hover:text-foreground'
                }`}>
                <ArrowUpDown size={10} />
                <span>{t(SORT_META[sortKey].labelKey)}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={4}
              className="w-auto min-w-[110px] rounded-2xs border-border/40 p-1">
              <MenuList>
                {SORT_ORDER.map((k) => (
                  <MenuItem
                    key={k}
                    variant="ghost"
                    size="sm"
                    active={sortKey === k}
                    label={t(SORT_META[k].labelKey)}
                    onClick={() => {
                      onSortKeyChange(k)
                      setShowSort(false)
                    }}
                  />
                ))}
              </MenuList>
            </PopoverContent>
          </Popover>

          {/* View toggle */}
          <ButtonGroup className="overflow-hidden rounded-3xs border border-border/40">
            <Button
              variant="ghost"
              onClick={() => onViewModeChange('grid')}
              className={`h-auto min-h-0 w-auto p-1.5 font-normal shadow-none transition-colors focus-visible:ring-0 ${
                viewMode === 'grid'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground/50 hover:bg-accent/30 hover:text-foreground'
              }`}>
              <LayoutGrid size={11} />
            </Button>
            <Button
              variant="ghost"
              onClick={() => onViewModeChange('list')}
              className={`h-auto min-h-0 w-auto p-1.5 font-normal shadow-none transition-colors focus-visible:ring-0 ${
                viewMode === 'list'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground/50 hover:bg-accent/30 hover:text-foreground'
              }`}>
              <List size={11} />
            </Button>
          </ButtonGroup>

          <div className="flex-1" />

          {/* Separator */}
          <Separator orientation="vertical" className="h-4 shrink-0 bg-border/30" />

          {/* Create */}
          <Popover
            open={showCreate}
            onOpenChange={(open) => {
              setShowCreate(open)
              if (open) setShowSort(false)
            }}>
            <PopoverTrigger asChild>
              <Button
                variant="default"
                className="flex h-auto min-h-0 items-center gap-1.5 rounded-3xs bg-foreground px-3 py-1.5 font-normal text-[11px] text-background shadow-none transition-colors hover:bg-foreground/90 focus-visible:ring-0 active:scale-[0.97]">
                <Plus size={11} className="lucide-custom" />
                <span>{t('library.toolbar.new_resource')}</span>
                <ChevronDown
                  size={9}
                  className={`lucide-custom transition-transform ${showCreate ? 'rotate-180' : ''}`}
                />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={4}
              className="w-auto min-w-[140px] rounded-2xs border-border/40 p-1">
              <MenuList>
                {(['agent', 'assistant'] as const).map((resourceType) => {
                  const meta = RESOURCE_TYPE_META[resourceType]
                  const Icon = meta.icon
                  return (
                    <MenuItem
                      key={resourceType}
                      variant="ghost"
                      size="sm"
                      icon={
                        <div className={`flex h-5 w-5 items-center justify-center rounded-4xs ${meta.color}`}>
                          <Icon size={10} />
                        </div>
                      }
                      label={t('library.create_menu.create', { type: t(meta.labelKey) })}
                      onClick={() => {
                        onCreate(resourceType)
                        setShowCreate(false)
                      }}
                    />
                  )
                })}
                <MenuDivider className="bg-border/30" />
                <MenuItem
                  variant="ghost"
                  size="sm"
                  icon={
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded-4xs ${RESOURCE_TYPE_META.assistant.color}`}>
                      <Upload size={10} />
                    </div>
                  }
                  label={t('assistants.presets.import.action')}
                  onClick={() => {
                    onImportAssistant()
                    setShowCreate(false)
                  }}
                />
                <MenuItem
                  variant="ghost"
                  size="sm"
                  icon={
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded-4xs ${RESOURCE_TYPE_META.skill.color}`}>
                      <Upload size={10} />
                    </div>
                  }
                  label={t('library.create_menu.import', { type: t(RESOURCE_TYPE_META.skill.labelKey) })}
                  onClick={() => {
                    onCreate('skill')
                    setShowCreate(false)
                  }}
                />
              </MenuList>
            </PopoverContent>
          </Popover>
        </div>

        {/* Row 2: Tag chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto px-5 pb-3 [&::-webkit-scrollbar]:h-0">
          <Tag size={11} className="mr-0.5 shrink-0 text-muted-foreground/40" />
          {tags.map((tag) => (
            <Button
              variant="ghost"
              key={tag.id}
              onClick={() => onTagFilter(activeTag === tag.name ? null : tag.name)}
              className={`flex h-auto min-h-0 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-[3px] font-normal text-[10px] shadow-none transition-all focus-visible:ring-0 ${
                activeTag === tag.name
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-border/30 text-muted-foreground/50 hover:border-border/50 hover:bg-accent/30 hover:text-foreground'
              }`}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
              <span>{tag.name}</span>
              <span className="text-[9px] text-muted-foreground/40 tabular-nums">{tag.count}</span>
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
                className="h-auto w-[80px] rounded-full border border-border/40 bg-accent/20 px-2 py-[3px] text-[10px] text-foreground shadow-none outline-none transition-all placeholder:text-muted-foreground/35 focus-visible:border-primary/40 focus-visible:ring-0 disabled:opacity-50"
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
              className="flex h-auto min-h-0 shrink-0 items-center gap-0.5 rounded-full border border-border/40 border-dashed px-2 py-[3px] font-normal text-[10px] text-muted-foreground/40 shadow-none transition-all hover:border-border/60 hover:bg-accent/30 hover:text-foreground focus-visible:ring-0">
              <Plus size={9} /> {t('library.toolbar.tag_button')}
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
        {resources.length === 0 ? (
          <EmptyState
            preset={search ? 'no-result' : 'no-resource'}
            title={search ? t('library.empty_state.no_match_title') : t('library.empty_state.empty_title')}
            description={
              search ? t('library.empty_state.no_match_description') : t('library.empty_state.empty_description')
            }
            className="py-20"
          />
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {resources.map((r, i) => (
              <GridCard key={r.id} resource={r} index={i} onEdit={onEdit} onToggle={onToggle} onOpenMenu={openMenu} />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {resources.map((r, i) => (
              <ListRow key={r.id} resource={r} index={i} onEdit={onEdit} onToggle={onToggle} onOpenMenu={openMenu} />
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

interface CardItemProps {
  resource: ResourceItem
  index: number
  onEdit: (r: ResourceItem) => void
  onToggle: (id: string) => void
  onOpenMenu: (id: string, e: MouseEvent) => void
}

function GridCard({ resource: r, index, onEdit, onToggle, onOpenMenu }: CardItemProps) {
  const { t } = useTranslation()
  const cfg = RESOURCE_TYPE_META[r.type]
  const isToolType = r.type === 'skill'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.02 }}
      whileHover={{ y: -2 }}
      className="group relative cursor-pointer rounded-2xs border border-border/30 bg-card transition-all duration-200 hover:border-border/50 hover:shadow-lg"
      onClick={() => onEdit(r)}>
      <div className="p-4">
        <div className="mb-3 flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xs text-base ${
              !isToolType ? 'bg-accent/50' : cfg.color
            }`}>
            {r.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h4 className="truncate text-[12px] text-foreground/75">{r.name}</h4>
              {r.hasUpdate && (
                <Badge
                  variant="secondary"
                  className="shrink-0 border-0 bg-warning/10 px-1 py-px text-[7px] text-warning">
                  {t('library.badge.update')}
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <Badge
                variant="secondary"
                className={`shrink-0 whitespace-nowrap border-0 px-1.5 py-px text-[8px] ${cfg.color}`}>
                {t(cfg.labelKey)}
              </Badge>
              {(r.model || r.version) && (
                <span className="min-w-0 flex-1 truncate text-[9px] text-muted-foreground/40">
                  {[r.model, r.version && `v${r.version}`].filter(Boolean).join(' ')}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => onOpenMenu(r.id, e)}
              className="flex h-6 min-h-0 w-6 items-center justify-center rounded-4xs p-0 font-normal text-muted-foreground/25 opacity-0 shadow-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-0 group-hover:opacity-100">
              <MoreHorizontal size={12} />
            </Button>
          </div>
        </div>
        <p className="mb-3 line-clamp-2 min-h-[2lh] text-[10px] text-muted-foreground/70 leading-relaxed">
          {r.description}
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/50">
            <Clock size={8} />
            <span>{timeAgo(t, r.updatedAt)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {r.tags.slice(0, 2).map((t, i) => (
              <Badge
                key={`${t}-${i}`}
                variant="secondary"
                className="border-0 bg-accent/50 px-1.5 py-px text-[8px] text-muted-foreground/50">
                {t}
              </Badge>
            ))}
            {r.tags.length > 2 && <span className="text-[8px] text-muted-foreground/45">+{r.tags.length - 2}</span>}
            {isToolType && (
              <div onClick={(e) => e.stopPropagation()}>
                <Switch
                  checked={r.enabled}
                  onCheckedChange={() => onToggle(r.id)}
                  classNames={{
                    root: 'h-4 w-7 shadow-none data-[state=checked]:bg-primary/70 data-[state=unchecked]:bg-accent/60',
                    thumb: 'size-3 ml-[1px] mt-[2px] bg-white shadow-sm data-[state=checked]:translate-x-3',
                    thumbSvg: 'hidden'
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function ListRow({ resource: r, index, onEdit, onToggle, onOpenMenu }: CardItemProps) {
  const { t } = useTranslation()
  const cfg = RESOURCE_TYPE_META[r.type]
  const isToolType = r.type === 'skill'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: index * 0.015 }}
      className="group flex cursor-pointer items-center gap-3 rounded-2xs px-3 py-2.5 transition-colors hover:bg-accent/30"
      onClick={() => onEdit(r)}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-3xs bg-accent/50 text-sm">
        {r.avatar}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11px] text-foreground">{r.name}</span>
          <Badge variant="secondary" className={`shrink-0 border-0 px-1.5 py-px text-[8px] ${cfg.color}`}>
            {t(cfg.labelKey)}
          </Badge>
          {r.hasUpdate && (
            <Badge variant="secondary" className="shrink-0 border-0 bg-warning/10 px-1 py-px text-[7px] text-warning">
              {t('library.badge.update')}
            </Badge>
          )}
        </div>
        <p className="mt-px truncate text-[9px] text-muted-foreground/55">{r.description}</p>
      </div>
      {r.model && <span className="hidden shrink-0 text-[9px] text-muted-foreground/50 sm:block">{r.model}</span>}
      {r.version && <span className="hidden shrink-0 text-[9px] text-muted-foreground/50 sm:block">v{r.version}</span>}
      {r.tags.length > 0 && (
        <div className="hidden shrink-0 items-center gap-1 lg:flex">
          {r.tags.slice(0, 2).map((t) => (
            <Badge
              key={t}
              variant="secondary"
              className="border-0 bg-accent/50 px-1.5 py-px text-[8px] text-muted-foreground/50">
              {t}
            </Badge>
          ))}
          {r.tags.length > 2 && <span className="text-[8px] text-muted-foreground/35">+{r.tags.length - 2}</span>}
        </div>
      )}
      <div className="hidden shrink-0 items-center gap-1 text-[9px] text-muted-foreground/45 md:flex">
        <Clock size={8} />
        <span>{timeAgo(t, r.updatedAt)}</span>
      </div>
      {isToolType && (
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          <Switch
            checked={r.enabled}
            onCheckedChange={() => onToggle(r.id)}
            classNames={{
              root: 'h-4 w-7 shadow-none data-[state=checked]:bg-primary/70 data-[state=unchecked]:bg-accent/60',
              thumb: 'size-3 ml-[1px] mt-[2px] bg-white shadow-sm data-[state=checked]:translate-x-3',
              thumbSvg: 'hidden'
            }}
          />
        </div>
      )}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => onOpenMenu(r.id, e)}
          className="flex h-6 min-h-0 w-6 items-center justify-center rounded-4xs p-0 font-normal text-muted-foreground/35 opacity-0 shadow-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-0 group-hover:opacity-100">
          <MoreHorizontal size={12} />
        </Button>
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

function FixedCardMenu({
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

  // Tag binding today is only wired for assistants. `updateAssistant` is
  // instantiated for every resource via a stable path, but call-sites below
  // guard on type. Tag ids ride on the assistant PATCH so the server binds
  // them atomically with any other column change — no separate tag endpoint.
  const { ensureTags } = useEnsureTags()
  const { updateAssistant } = useAssistantMutationsById(resource.id)
  const canBindTags = resource.type === 'assistant'

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
      try {
        const tags = await ensureTags(nextNames)
        await updateAssistant({ tagIds: tags.map((t) => t.id) })
        onUpdateResourceTags(resource.id, nextNames)
      } catch (e) {
        // Roll back optimistic state on failure.
        setLocalTags(previousNames)
        setBindingError(e instanceof Error ? e.message : t('library.tag_sync_failed'))
      }
    },
    [canBindTags, ensureTags, updateAssistant, onUpdateResourceTags, resource.id, t]
  )

  const toggleTag = (tag: string) => {
    const prev = localTags
    const next = prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    setLocalTags(next)
    setBindingError(null)
    void persistTags(next, prev)
  }

  const addNewTag = () => {
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
        className="fixed z-[501] min-w-[140px] rounded-2xs border border-border/30 bg-popover p-1 shadow-xl"
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

        {/* Tag picker — assistants only (agent/skill backend not ready) */}
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
                    <span className="text-[8px] text-muted-foreground/25 tabular-nums">{localTags.length}</span>
                  )}
                  <ChevronDown size={8} className={`transition-transform ${showTagPicker ? 'rotate-180' : ''}`} />
                </>
              }
              onClick={() => setShowTagPicker(!showTagPicker)}
            />
            {bindingError && <p className="px-2.5 py-1 text-[9px] text-destructive/80">{bindingError}</p>}
            {showTagPicker && (
              <div
                className={`absolute ${subMenuPos} flex max-h-[260px] min-w-[160px] flex-col rounded-2xs border border-border/30 bg-popover p-1 shadow-xl`}>
                <div className="mb-0.5 flex items-center gap-1 px-2 py-1">
                  <Input
                    autoFocus
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addNewTag()
                    }}
                    placeholder={t('library.tag_picker.placeholder')}
                    className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-[10px] text-foreground shadow-none outline-none placeholder:text-muted-foreground/20 focus-visible:ring-0"
                  />
                  {tagInput.trim() && (
                    <Button
                      variant="ghost"
                      onClick={addNewTag}
                      className="h-auto min-h-0 w-auto p-0 font-normal text-muted-foreground/30 shadow-none transition-colors hover:text-foreground focus-visible:ring-0">
                      <Plus size={10} />
                    </Button>
                  )}
                </div>
                <Separator className="mx-1 mb-0.5 bg-border/15" />
                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[2px]">
                  {allTagNames.length === 0 && !tagInput.trim() && (
                    <p className="px-2.5 py-2 text-center text-[9px] text-muted-foreground/20">
                      {t('library.tag_picker.no_tags')}
                    </p>
                  )}
                  {allTagNames.map((tag) => {
                    const checked = localTags.includes(tag)
                    return (
                      <label
                        key={tag}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-4xs px-2.5 py-[5px] text-[10px] text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground">
                        <Checkbox
                          size="sm"
                          checked={checked}
                          onCheckedChange={() => toggleTag(tag)}
                          className="size-3.5 rounded-4xs border-border/30 bg-transparent shadow-none transition-colors hover:bg-transparent focus-visible:ring-0 data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background [&_[data-slot=checkbox-indicator]_svg]:size-2"
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
          label={t('common.delete')}
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
