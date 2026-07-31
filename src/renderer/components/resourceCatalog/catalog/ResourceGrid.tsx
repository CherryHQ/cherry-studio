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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  SearchInput,
  Skeleton
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { CreateGroupDialog } from '@renderer/components/CreateGroupDialog'
import { SettingDescription, SettingDivider, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { useGroupMutations } from '@renderer/hooks/useGroups'
import { toast } from '@renderer/services/toast'
import type { GroupItem, ResourceItem, ResourceType } from '@renderer/types/resourceCatalog'
import { RESOURCE_TYPE_META } from '@renderer/utils/resourceCatalog'
import { cn } from '@renderer/utils/style'
import type { Group } from '@shared/data/types/group'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderSearch,
  Import,
  Library,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2
} from 'lucide-react'
import type { FC, ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceCatalogSearchInput } from '../ResourceCatalogSearchInput'
import { ResourceCard } from './ResourceCards'

const logger = loggerService.withContext('ResourceGrid')

const GRID_GAP_PX = 12
const RESOURCE_CARD_ROW_ESTIMATE_PX = 92

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
  /** Open the community assistant library dialog. When omitted the add menu hides the library item. */
  onOpenAssistantLibrary?: () => void
  onOpenSkillMarketplace: () => void
  onOpenSystemSkills?: () => void
  groups: GroupItem[]
  activeGroupId: string | null
  onGroupFilter: (groupId: string | null) => void
  /** Create a new assistant group. Does not assign it to an assistant. */
  onAddGroup: (groupName: string) => Promise<void> | void
  allGroups: Group[]
  toolbarLeading?: ReactNode
  variant?: 'library' | 'settings'
  /** Settings variant only: page heading rendered above the search row. */
  title?: ReactNode
  description?: ReactNode
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

interface AssistantAddActionsProps {
  onNew: () => void
  onImport: () => void
  onOpenLibrary?: () => void
}

/**
 * Assistant creation actions are intentionally flat so each entry point stays visible in the toolbar.
 */
function AssistantAddActions({ onNew, onImport, onOpenLibrary }: AssistantAddActionsProps) {
  const { t } = useTranslation()

  return (
    <>
      <Button variant="default" size="sm" onClick={onNew} className="shrink-0">
        <Plus size={12} className="lucide-custom" />
        <span>{t('library.create_menu.create', { type: t(RESOURCE_TYPE_META.assistant.labelKey) })}</span>
      </Button>
      {onOpenLibrary ? (
        <Button variant="outline" size="sm" onClick={onOpenLibrary} className="shrink-0">
          <Library size={12} />
          <span>{t('library.assistant_catalog.title')}</span>
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={onImport} className="shrink-0">
        <Import size={12} />
        <span>{t('assistants.presets.import.action')}</span>
      </Button>
    </>
  )
}

interface SkillAddActionsProps {
  onSearchMarketplace: () => void
  onSearchSystem?: () => void
  onImportLocal: () => void
  size?: 'sm' | 'default'
}

function SkillAddActions({ onSearchMarketplace, onSearchSystem, onImportLocal, size = 'sm' }: SkillAddActionsProps) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="default" size={size} className="shrink-0">
          <Plus size={size === 'sm' ? 12 : 16} className="lucide-custom" />
          <span>{t('library.skill_add.add')}</span>
          <ChevronDown size={size === 'sm' ? 12 : 14} className="text-primary-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onSelect={onSearchMarketplace} className="gap-2">
          <Search size={13} />
          <span>{t('library.skill_add.online_search')}</span>
        </DropdownMenuItem>
        {onSearchSystem ? (
          <DropdownMenuItem onSelect={onSearchSystem} className="gap-2">
            <FolderSearch size={13} />
            <span>{t('library.skill_add.system_search')}</span>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onImportLocal} className="gap-2">
          <Import size={13} />
          <span>{t('library.skill_add.local_import')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
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
  onOpenAssistantLibrary,
  onOpenSkillMarketplace,
  onOpenSystemSkills,
  groups,
  activeGroupId,
  onGroupFilter,
  onAddGroup,
  allGroups,
  toolbarLeading,
  variant = 'library',
  title,
  description
}) => {
  const { t } = useTranslation()
  const isSettings = variant === 'settings'
  const { updateGroup, deleteGroup } = useGroupMutations('assistant', {
    refreshOnDelete: ['/assistants', '/assistants/*']
  })
  const scrollRef = useRef<HTMLDivElement>(null)
  const columnCount = useGridColumnCount(scrollRef)
  const [showAllGroups, setShowAllGroups] = useState(false)
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false)
  const [renamingGroup, setRenamingGroup] = useState<GroupItem | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState<GroupItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const showGroupToolbar = activeResourceType === 'assistant'
  const unusedGroups = useMemo(() => {
    const usedIds = new Set(groups.map((group) => group.id))
    return allGroups
      .filter((group) => !usedIds.has(group.id))
      .map((group) => ({ id: group.id, name: group.name, count: 0 }))
  }, [allGroups, groups])
  const visibleGroups = useMemo(() => {
    if (!showAllGroups) return groups

    const countById = new Map(groups.map((group) => [group.id, group.count] as const))
    return allGroups.map((group) => ({
      id: group.id,
      name: group.name,
      count: countById.get(group.id) ?? 0
    }))
  }, [allGroups, groups, showAllGroups])

  const handleAddGroup = useCallback(
    async (name: string) => {
      try {
        await onAddGroup(name)
      } catch (error) {
        logger.error('Failed to create assistant group', error instanceof Error ? error : new Error(String(error)), {
          name
        })
        throw error
      }
    },
    [onAddGroup]
  )

  const handleOpenRenameGroup = useCallback((group: GroupItem) => {
    setRenamingGroup(group)
    setRenameValue(group.name)
  }, [])

  const handleRenameGroup = useCallback(async () => {
    const group = renamingGroup
    const nextName = renameValue.trim()
    if (!group || renaming || !nextName) return

    if (nextName === group.name) {
      setRenamingGroup(null)
      return
    }

    setRenaming(true)
    try {
      await updateGroup(group.id, { name: nextName })
      setRenamingGroup(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('library.group_sync_failed')
      toast.error(message)
      logger.error('Failed to rename assistant group', error instanceof Error ? error : new Error(String(error)), {
        id: group.id,
        name: group.name,
        nextName
      })
    } finally {
      setRenaming(false)
    }
  }, [renameValue, renaming, renamingGroup, t, updateGroup])

  const handleConfirmDeleteGroup = useCallback(async () => {
    const group = deletingGroup
    if (!group || deleting) return

    setDeleting(true)
    try {
      await deleteGroup(group.id)
      if (activeGroupId === group.id) onGroupFilter(null)
      setDeletingGroup(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('library.group_sync_failed')
      toast.error(message)
      logger.error('Failed to delete assistant group', error instanceof Error ? error : new Error(String(error)), {
        id: group.id,
        name: group.name
      })
    } finally {
      setDeleting(false)
    }
  }, [activeGroupId, deleteGroup, deleting, deletingGroup, onGroupFilter, t])

  const addActions =
    activeResourceType === 'assistant' ? (
      <AssistantAddActions
        onNew={() => onCreate('assistant')}
        onImport={onImportAssistant}
        onOpenLibrary={onOpenAssistantLibrary}
      />
    ) : activeResourceType === 'skill' ? (
      <SkillAddActions
        onSearchMarketplace={onOpenSkillMarketplace}
        onSearchSystem={onOpenSystemSkills}
        onImportLocal={() => onCreate('skill')}
        size={isSettings ? 'default' : 'sm'}
      />
    ) : (
      <Button
        variant="default"
        size={isSettings ? 'default' : 'sm'}
        onClick={() => onCreate(activeResourceType)}
        className="shrink-0">
        <Plus size={isSettings ? 16 : 12} className="lucide-custom" />
        <span>{t('library.create_menu.create', { type: t(RESOURCE_TYPE_META[activeResourceType].labelKey) })}</span>
      </Button>
    )

  const searchInput = isSettings ? (
    <SearchInput
      aria-label={t('library.toolbar.search_placeholder')}
      placeholder={t('library.toolbar.search_placeholder')}
      value={search}
      onChange={(event) => onSearchChange(event.currentTarget.value)}
      onClear={() => onSearchChange('')}
      clearLabel={t('common.clear')}
    />
  ) : (
    <ResourceCatalogSearchInput
      value={search}
      onValueChange={onSearchChange}
      placeholder={t('library.toolbar.search_placeholder')}
      className="max-w-64 flex-1"
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn('flex shrink-0 flex-col', !isSettings && 'border-border-subtle border-b')}>
        {isSettings ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <SettingTitle>
                  <span>{title}</span>
                </SettingTitle>
                {description ? <SettingDescription className="mt-0">{description}</SettingDescription> : null}
              </div>
              {addActions}
            </div>
            <SettingDivider />
            <div className="flex shrink-0 flex-wrap items-center gap-2 py-1">
              <div className="min-w-56 flex-1 [&>[data-slot=input-group]]:border-border [&>[data-slot=input-group]]:bg-transparent">
                {searchInput}
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-12 shrink-0 items-center gap-2 px-5">
            {toolbarLeading && <div className="flex shrink-0 items-center">{toolbarLeading}</div>}
            {searchInput}

            <div className="flex-1" />

            <div className="flex shrink-0 items-center gap-2">{addActions}</div>
          </div>
        )}

        {showGroupToolbar && (
          <div className="flex items-center overflow-x-auto px-2 pt-1 pb-2 [&::-webkit-scrollbar]:h-0">
            <div
              className={
                toolbarLeading
                  ? 'flex size-[30px] shrink-0 items-center justify-center'
                  : 'flex size-3 shrink-0 items-center'
              }>
              <Tag size={14} className="text-foreground-tertiary" />
            </div>
            <div className="ml-2 flex shrink-0 items-center gap-1.5">
              {visibleGroups.map((group) => (
                <ContextMenu key={group.id}>
                  <ContextMenuTrigger asChild>
                    <Button
                      variant={activeGroupId === group.id ? 'secondary' : 'ghost'}
                      onClick={() => onGroupFilter(activeGroupId === group.id ? null : group.id)}
                      className={`flex h-6 min-h-0 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs shadow-none ${
                        activeGroupId === group.id
                          ? 'border-border-selected bg-secondary text-secondary-foreground hover:text-secondary-foreground'
                          : 'border-border-subtle text-muted-foreground hover:border-border-strong hover:bg-accent hover:text-foreground'
                      }`}>
                      <span>{group.name}</span>
                      <span className="text-foreground-tertiary text-xs tabular-nums">{group.count}</span>
                    </Button>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="min-w-32">
                    <ContextMenuItem onSelect={() => handleOpenRenameGroup(group)}>
                      <ContextMenuItemContent icon={<Pencil size={12} />}>{t('common.rename')}</ContextMenuItemContent>
                    </ContextMenuItem>
                    <ContextMenuItem variant="destructive" onSelect={() => setDeletingGroup(group)}>
                      <ContextMenuItemContent icon={<Trash2 size={12} />}>
                        {t('assistants.groups.delete')}
                      </ContextMenuItemContent>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}

              {unusedGroups.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('library.toolbar.all_groups')}
                  title={t('library.toolbar.all_groups')}
                  onClick={() => setShowAllGroups((value) => !value)}
                  className="size-6 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
                  {showAllGroups ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
                </Button>
              )}

              <Button
                variant="ghost"
                onClick={() => setCreateGroupDialogOpen(true)}
                className="flex h-6 min-h-0 shrink-0 items-center gap-1 rounded-full border border-border-subtle border-dashed px-2 text-muted-foreground text-xs shadow-none hover:border-border-strong hover:bg-accent hover:text-foreground">
                <Plus size={11} /> {t('library.toolbar.group_button')}
              </Button>
            </div>
          </div>
        )}
        <CreateGroupDialog
          open={createGroupDialogOpen}
          onCreate={handleAddGroup}
          onOpenChange={setCreateGroupDialogOpen}
        />
        <Dialog
          open={Boolean(renamingGroup)}
          onOpenChange={(open) => {
            if (!open && !renaming) setRenamingGroup(null)
          }}>
          <DialogContent closeOnOverlayClick={false} size="sm">
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
                if (event.key === 'Enter') void handleRenameGroup()
                if (event.key === 'Escape' && !renaming) setRenamingGroup(null)
              }}
              disabled={renaming}
              className="h-9 rounded-md border-input bg-background"
            />
            <DialogFooter>
              <Button variant="outline" size="sm" disabled={renaming} onClick={() => setRenamingGroup(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                loading={renaming}
                disabled={!renameValue.trim()}
                onClick={() => void handleRenameGroup()}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={Boolean(deletingGroup)}
          onOpenChange={(open) => {
            if (!open && !deleting) setDeletingGroup(null)
          }}
          title={t('assistants.groups.delete')}
          description={t('assistants.groups.deleteConfirm')}
          confirmText={t('common.delete')}
          cancelText={t('common.cancel')}
          destructive
          confirmLoading={deleting}
          onConfirm={handleConfirmDeleteGroup}
        />
      </div>

      <div
        ref={scrollRef}
        className={cn(
          'flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--scrollbar-thumb)] [&::-webkit-scrollbar]:w-1',
          isSettings ? 'py-3' : 'px-5 py-4'
        )}>
        {isLoading ? (
          <ResourceGridLoadingState columnCount={columnCount} resourceType={activeResourceType} />
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
            allGroups={allGroups}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onEdit={onEdit}
            onExport={onExport}
          />
        )}
      </div>
    </div>
  )
}

function ResourceGridLoadingState({ columnCount, resourceType }: { columnCount: number; resourceType: ResourceType }) {
  const count = Math.max(columnCount, 1) * 4

  return (
    <div
      className="grid gap-3"
      data-testid="resource-grid-loading"
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="rounded-lg border border-border-subtle bg-card p-3.5"
          style={
            resourceType === 'skill' ? { backgroundColor: 'var(--settings-group-background, var(--card))' } : undefined
          }>
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
  allGroups: Group[]
  onDelete: (r: ResourceItem) => void
  onDuplicate: (r: ResourceItem) => void
  onEdit: (r: ResourceItem) => void
  onExport: (r: ResourceItem) => void
}

function VirtualizedResourceGrid({
  scrollRef,
  columnCount,
  resources,
  allGroups,
  onDelete,
  onDuplicate,
  onEdit,
  onExport
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
                allGroups={allGroups}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onEdit={onEdit}
                onExport={onExport}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

export default ResourceGrid
