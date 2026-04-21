import { Checkbox, EmptyState, Input, Switch } from '@cherrystudio/ui'
import { t } from 'i18next'
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

import { useAssistantMutationsById } from '../adapters/assistantAdapter'
import { useEnsureTags, useTagList } from '../adapters/tagAdapter'
import { DEFAULT_TAG_COLOR, RESOURCE_TYPE_CONFIG, SORT_LABELS, TAG_COLORS } from '../constants'
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

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
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
              placeholder="搜索资源名称、描述..."
              className="h-auto w-full rounded-3xs border border-border/40 bg-accent/20 py-1.5 pr-7 pl-7 text-[11px] text-foreground shadow-none outline-none transition-all placeholder:text-muted-foreground/40 focus-visible:border-primary/40 focus-visible:bg-accent/30 focus-visible:ring-0 md:text-[11px]"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="-translate-y-1/2 absolute top-1/2 right-2 text-muted-foreground/40 transition-colors hover:text-foreground">
                <X size={10} />
              </button>
            )}
          </div>

          {/* Sort */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowSort(!showSort)
                setShowCreate(false)
              }}
              className={`flex items-center gap-1.5 rounded-3xs border px-2.5 py-1.5 text-[10px] transition-all ${
                showSort
                  ? 'border-primary/30 bg-accent/60 text-foreground'
                  : 'border-border/40 text-muted-foreground/60 hover:border-border/60 hover:text-foreground'
              }`}>
              <ArrowUpDown size={10} />
              <span>{SORT_LABELS[sortKey]}</span>
            </button>
            <AnimatePresence>
              {showSort && (
                <div>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSort(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full left-0 z-50 mt-1 min-w-[110px] rounded-2xs border border-border/40 bg-popover p-1 shadow-xl">
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                      <button
                        type="button"
                        key={k}
                        onClick={() => {
                          onSortKeyChange(k)
                          setShowSort(false)
                        }}
                        className={`w-full rounded-4xs px-2.5 py-[5px] text-left text-[10px] transition-colors ${
                          sortKey === k
                            ? 'bg-accent text-foreground'
                            : 'text-muted-foreground/70 hover:bg-accent/50 hover:text-foreground'
                        }`}>
                        {SORT_LABELS[k]}
                      </button>
                    ))}
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* View toggle */}
          <div className="flex items-center overflow-hidden rounded-3xs border border-border/40">
            <button
              type="button"
              onClick={() => onViewModeChange('grid')}
              className={`p-1.5 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground/50 hover:bg-accent/30 hover:text-foreground'
              }`}>
              <LayoutGrid size={11} />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('list')}
              className={`p-1.5 transition-colors ${
                viewMode === 'list'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground/50 hover:bg-accent/30 hover:text-foreground'
              }`}>
              <List size={11} />
            </button>
          </div>

          <div className="flex-1" />

          {/* Separator */}
          <div className="h-4 w-px shrink-0 bg-border/30" />

          {/* Create */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowCreate(!showCreate)
                setShowSort(false)
              }}
              className="flex items-center gap-1.5 rounded-3xs bg-foreground px-3 py-1.5 text-[11px] text-background transition-colors hover:bg-foreground/90 active:scale-[0.97]">
              <Plus size={11} className="lucide-custom" />
              <span>新建资源</span>
              <ChevronDown
                size={9}
                className={`lucide-custom transition-transform ${showCreate ? 'rotate-180' : ''}`}
              />
            </button>
            <AnimatePresence>
              {showCreate && (
                <div>
                  <div className="fixed inset-0 z-40" onClick={() => setShowCreate(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full right-0 z-50 mt-1 min-w-[140px] rounded-2xs border border-border/40 bg-popover p-1 shadow-xl">
                    {(['agent', 'assistant'] as const).map((resourceType) => {
                      const cfg = RESOURCE_TYPE_CONFIG[resourceType]
                      const Icon = cfg.icon
                      return (
                        <button
                          key={resourceType}
                          type="button"
                          onClick={() => {
                            onCreate(resourceType)
                            setShowCreate(false)
                          }}
                          className="flex w-full items-center gap-2 rounded-4xs px-2.5 py-[6px] text-[10px] text-muted-foreground/70 transition-colors hover:bg-accent/50 hover:text-foreground">
                          <div className={`flex h-5 w-5 items-center justify-center rounded-4xs ${cfg.color}`}>
                            <Icon size={10} />
                          </div>
                          <span>新建{cfg.label}</span>
                        </button>
                      )
                    })}
                    <div className="mx-1 my-0.5 h-px bg-border/30" />
                    <button
                      type="button"
                      onClick={() => {
                        onImportAssistant()
                        setShowCreate(false)
                      }}
                      className="flex w-full items-center gap-2 rounded-4xs px-2.5 py-[6px] text-[10px] text-muted-foreground/70 transition-colors hover:bg-accent/50 hover:text-foreground">
                      <div
                        className={`flex h-5 w-5 items-center justify-center rounded-4xs ${RESOURCE_TYPE_CONFIG.assistant.color}`}>
                        <Upload size={10} />
                      </div>
                      <span>{t('assistants.presets.import.action')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onCreate('skill')
                        setShowCreate(false)
                      }}
                      className="flex w-full items-center gap-2 rounded-4xs px-2.5 py-[6px] text-[10px] text-muted-foreground/70 transition-colors hover:bg-accent/50 hover:text-foreground">
                      <div
                        className={`flex h-5 w-5 items-center justify-center rounded-4xs ${RESOURCE_TYPE_CONFIG.skill.color}`}>
                        <Upload size={10} />
                      </div>
                      <span>导入{RESOURCE_TYPE_CONFIG.skill.label}</span>
                    </button>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Row 2: Tag chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto px-5 pb-3 [&::-webkit-scrollbar]:h-0">
          <Tag size={11} className="mr-0.5 shrink-0 text-muted-foreground/40" />
          {tags.map((tag) => (
            <button
              type="button"
              key={tag.id}
              onClick={() => onTagFilter(activeTag === tag.name ? null : tag.name)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[10px] transition-all ${
                activeTag === tag.name
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-border/30 text-muted-foreground/50 hover:border-border/50 hover:bg-accent/30 hover:text-foreground'
              }`}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
              <span>{tag.name}</span>
              <span className="text-[9px] text-muted-foreground/40 tabular-nums">{tag.count}</span>
            </button>
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
                placeholder="标签名..."
                className="h-auto w-[80px] rounded-full border border-border/40 bg-accent/20 px-2 py-[3px] text-[10px] text-foreground shadow-none outline-none transition-all placeholder:text-muted-foreground/35 focus-visible:border-primary/40 focus-visible:ring-0 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void handleAddTag()}
                disabled={addingTag || !newTagName.trim()}
                className="text-muted-foreground/40 transition-colors hover:text-foreground disabled:opacity-40">
                <Plus size={10} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAddTag(true)}
              className="flex shrink-0 items-center gap-0.5 rounded-full border border-border/40 border-dashed px-2 py-[3px] text-[10px] text-muted-foreground/40 transition-all hover:border-border/60 hover:bg-accent/30 hover:text-foreground">
              <Plus size={9} /> 标签
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
        {resources.length === 0 ? (
          <EmptyState
            preset={search ? 'no-result' : 'no-resource'}
            title={search ? '未找到匹配的资源' : '还没有任何资源'}
            description={search ? '尝试其他搜索关键词' : '创建你的第一个智能体或助手'}
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
  const cfg = RESOURCE_TYPE_CONFIG[r.type]
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
                <span className="shrink-0 rounded-full bg-warning/10 px-1 py-px text-[7px] text-warning">更新</span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-px text-[8px] ${cfg.color}`}>
                {cfg.label}
              </span>
              {(r.model || r.version) && (
                <span className="min-w-0 flex-1 truncate text-[9px] text-muted-foreground/40">
                  {[r.model, r.version && `v${r.version}`].filter(Boolean).join(' ')}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={(e) => onOpenMenu(r.id, e)}
              className="flex h-6 w-6 items-center justify-center rounded-4xs text-muted-foreground/25 opacity-0 transition-colors hover:bg-accent/40 hover:text-foreground group-hover:opacity-100">
              <MoreHorizontal size={12} />
            </button>
          </div>
        </div>
        <p className="mb-3 line-clamp-2 min-h-[2lh] text-[10px] text-muted-foreground/70 leading-relaxed">
          {r.description}
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/50">
            <Clock size={8} />
            <span>{timeAgo(r.updatedAt)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {r.tags.slice(0, 2).map((t, i) => (
              <span
                key={`${t}-${i}`}
                className="rounded-full bg-accent/50 px-1.5 py-px text-[8px] text-muted-foreground/50">
                {t}
              </span>
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
  const cfg = RESOURCE_TYPE_CONFIG[r.type]
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
          <span className={`shrink-0 rounded-full px-1.5 py-px text-[8px] ${cfg.color}`}>{cfg.label}</span>
          {r.hasUpdate && (
            <span className="shrink-0 rounded-full bg-warning/10 px-1 py-px text-[7px] text-warning">更新</span>
          )}
        </div>
        <p className="mt-px truncate text-[9px] text-muted-foreground/55">{r.description}</p>
      </div>
      {r.model && <span className="hidden shrink-0 text-[9px] text-muted-foreground/50 sm:block">{r.model}</span>}
      {r.version && <span className="hidden shrink-0 text-[9px] text-muted-foreground/50 sm:block">v{r.version}</span>}
      {r.tags.length > 0 && (
        <div className="hidden shrink-0 items-center gap-1 lg:flex">
          {r.tags.slice(0, 2).map((t) => (
            <span key={t} className="rounded-full bg-accent/50 px-1.5 py-px text-[8px] text-muted-foreground/50">
              {t}
            </span>
          ))}
          {r.tags.length > 2 && <span className="text-[8px] text-muted-foreground/35">+{r.tags.length - 2}</span>}
        </div>
      )}
      <div className="hidden shrink-0 items-center gap-1 text-[9px] text-muted-foreground/45 md:flex">
        <Clock size={8} />
        <span>{timeAgo(r.updatedAt)}</span>
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
        <button
          type="button"
          onClick={(e) => onOpenMenu(r.id, e)}
          className="flex h-6 w-6 items-center justify-center rounded-4xs text-muted-foreground/35 opacity-0 transition-colors hover:bg-accent/40 hover:text-foreground group-hover:opacity-100">
          <MoreHorizontal size={12} />
        </button>
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
  const colorFor = (name: string): string =>
    tagList.tags.find((t) => t.name === name)?.color ?? TAG_COLORS[name] ?? DEFAULT_TAG_COLOR

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
        setBindingError(e instanceof Error ? e.message : '标签同步失败')
      }
    },
    [canBindTags, ensureTags, updateAssistant, onUpdateResourceTags, resource.id]
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
        <button
          type="button"
          onClick={() => {
            onEdit(resource)
            onClose()
          }}
          className="flex w-full items-center gap-2 rounded-4xs px-2.5 py-[5px] text-[10px] text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground">
          <Pencil size={10} /> 编辑
        </button>

        {/* Tag picker — assistants only (agent/skill backend not ready) */}
        {canBindTags && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTagPicker(!showTagPicker)}
              className="flex w-full items-center gap-2 rounded-4xs px-2.5 py-[5px] text-[10px] text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground">
              <Tag size={10} /> 管理标签
              {localTags.length > 0 && (
                <span className="ml-auto text-[8px] text-muted-foreground/25 tabular-nums">{localTags.length}</span>
              )}
              <ChevronDown size={8} className={`transition-transform ${showTagPicker ? 'rotate-180' : ''}`} />
            </button>
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
                    placeholder="新标签名..."
                    className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-[10px] text-foreground shadow-none outline-none placeholder:text-muted-foreground/20 focus-visible:ring-0"
                  />
                  {tagInput.trim() && (
                    <button
                      type="button"
                      onClick={addNewTag}
                      className="text-muted-foreground/30 transition-colors hover:text-foreground">
                      <Plus size={10} />
                    </button>
                  )}
                </div>
                <div className="mx-1 mb-0.5 h-px bg-border/15" />
                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[2px]">
                  {allTagNames.length === 0 && !tagInput.trim() && (
                    <p className="px-2.5 py-2 text-center text-[9px] text-muted-foreground/20">暂无标签</p>
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

        <button
          type="button"
          onClick={() => {
            onDuplicate(resource)
            onClose()
          }}
          className="flex w-full items-center gap-2 rounded-4xs px-2.5 py-[5px] text-[10px] text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground">
          <Copy size={10} /> 创建副本
        </button>
        {resource.type === 'assistant' && (
          <button
            type="button"
            onClick={() => {
              onExport(resource)
              onClose()
            }}
            className="flex w-full items-center gap-2 rounded-4xs px-2.5 py-[5px] text-[10px] text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground">
            <Download size={10} /> {t('assistants.presets.export.agent')}
          </button>
        )}
        <div className="mx-1 my-0.5 h-px bg-border/15" />
        <button
          type="button"
          onClick={() => {
            onDelete(resource)
            onClose()
          }}
          className="flex w-full items-center gap-2 rounded-4xs px-2.5 py-[5px] text-[10px] text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive">
          <Trash2 size={10} /> 删除
        </button>
      </motion.div>
    </div>
  )
}

export default ResourceGrid
