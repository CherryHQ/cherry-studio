import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Input,
  MenuDivider,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { useCache } from '@renderer/data/hooks/useCache'
import { useActiveNode } from '@renderer/hooks/useNotesQuery'
import type { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import {
  ArrowUpNarrowWide,
  Check,
  ChevronDown,
  FilePlus,
  Folder,
  FolderPlus,
  FolderUp,
  Loader2,
  Plus,
  Search,
  Star,
  Upload,
  X
} from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import TreeNode from './components/TreeNode'
import {
  NotesActionsContext,
  NotesDragContext,
  NotesEditingContext,
  NotesSearchContext,
  NotesSelectionContext
} from './context/NotesContexts'
import { useFullTextSearch } from './hooks/useFullTextSearch'
import { useNotesDragAndDrop } from './hooks/useNotesDragAndDrop'
import { useNotesEditing } from './hooks/useNotesEditing'
import { useNotesFileUpload } from './hooks/useNotesFileUpload'
import { useNotesMenu } from './hooks/useNotesMenu'

const iconTooltipClassNames = { placeholder: 'inline-flex' }

type GroupId = 'my-library'

type VirtualListItem =
  | { kind: 'node'; node: NotesTreeNode; depth: number }
  | { kind: 'group-header'; groupId: GroupId; label: string; count: number; expanded: boolean }
  | { kind: 'favorites-empty'; hint: string }

const SidebarGroupHeader: FC<{
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
  actions?: ReactNode
  leadingIcon?: ReactNode
  showChevron?: boolean
  showCount?: boolean
  ariaLabel?: string
  ariaPressed?: boolean
  className?: string
}> = ({
  label,
  count,
  expanded,
  onToggle,
  actions,
  leadingIcon,
  showChevron = true,
  showCount = true,
  ariaLabel,
  ariaPressed,
  className
}) => (
  <div
    className={cn(
      'flex w-full items-center gap-1.5 rounded-md px-3 py-1 text-foreground-secondary text-sm transition-colors hover:bg-sidebar-accent',
      className
    )}>
    <button
      type="button"
      onClick={(e) => {
        e.currentTarget.blur()
        onToggle()
      }}
      aria-expanded={expanded}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
      {leadingIcon}
      <span className="truncate">{label}</span>
      {showCount && count > 0 && <span className="shrink-0 text-foreground-muted tabular-nums">{count}</span>}
      {showChevron && (
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-foreground-muted transition-transform duration-150',
            expanded ? 'rotate-0' : '-rotate-90'
          )}
        />
      )}
    </button>
    {actions && <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>}
  </div>
)

interface NotesSidebarProps {
  onCreateFolder: (name: string, targetFolderId?: string) => void
  onCreateNote: (name: string, targetFolderId?: string) => void
  onSelectNode: (node: NotesTreeNode) => void
  onDeleteNode: (nodeId: string) => void
  onRenameNode: (nodeId: string, newName: string) => void
  onToggleExpanded: (nodeId: string) => void
  onToggleStar: (nodeId: string) => void
  onMoveNode: (sourceNodeId: string, targetNodeId: string, position: 'before' | 'after' | 'inside') => void
  onSortNodes: (sortType: NotesSortType) => void
  onUploadFiles: (files: File[]) => void
  notesTree: NotesTreeNode[]
  activeFilePath?: string
  sortType: NotesSortType
  selectedFolderId?: string | null
}

const NotesSidebar: FC<NotesSidebarProps> = ({
  onCreateFolder,
  onCreateNote,
  onSelectNode,
  onDeleteNode,
  onRenameNode,
  onToggleExpanded,
  onToggleStar,
  onMoveNode,
  onSortNodes,
  onUploadFiles,
  notesTree,
  activeFilePath,
  sortType,
  selectedFolderId
}) => {
  const { t } = useTranslation()
  const { activeNode } = useActiveNode(notesTree, activeFilePath)
  const [isShowSearch, setIsShowSearch] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [isDragOverSidebar, setIsDragOverSidebar] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [showFavoritesOnly, setShowFavoritesOnly] = useCache('notes.show_favorites_only')
  const [groupExpanded, setGroupExpanded] = useState<Record<GroupId, boolean>>({
    'my-library': true
  })

  const sortMenuItems: Array<{ label: string; key: NotesSortType } | { type: 'divider'; key: string }> = [
    { label: t('notes.sort_a2z'), key: 'sort_a2z' },
    { label: t('notes.sort_z2a'), key: 'sort_z2a' },
    { type: 'divider', key: 'divider-name' },
    { label: t('notes.sort_updated_desc'), key: 'sort_updated_desc' },
    { label: t('notes.sort_updated_asc'), key: 'sort_updated_asc' },
    { type: 'divider', key: 'divider-updated' },
    { label: t('notes.sort_created_desc'), key: 'sort_created_desc' },
    { label: t('notes.sort_created_asc'), key: 'sort_created_asc' }
  ]

  const toggleGroup = useCallback((groupId: GroupId) => {
    setGroupExpanded((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
  }, [])

  const virtualListRef = useRef<DynamicVirtualListRef>(null)
  const trimmedSearchKeyword = useMemo(() => searchKeyword.trim(), [searchKeyword])
  const hasSearchKeyword = trimmedSearchKeyword.length > 0
  const favoriteNotes = useMemo(() => {
    const collectStarredFiles = (nodes: NotesTreeNode[]): NotesTreeNode[] => {
      let result: NotesTreeNode[] = []
      for (const node of nodes) {
        if (node.type === 'file' && node.isStarred) {
          result.push(node)
        }
        if (node.children && node.children.length > 0) {
          result = [...result, ...collectStarredFiles(node.children)]
        }
      }
      return result
    }

    return collectStarredFiles(notesTree)
  }, [notesTree])
  const searchableNodes = showFavoritesOnly ? favoriteNotes : notesTree

  const { editingNodeId, renamingNodeIds, newlyRenamedNodeIds, inPlaceEdit, handleStartEdit, handleAutoRename } =
    useNotesEditing({ onRenameNode })

  const {
    draggedNodeId,
    dragOverNodeId,
    dragPosition,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd
  } = useNotesDragAndDrop({ onMoveNode })

  const { handleDropFiles, handleSelectFiles, handleSelectFolder } = useNotesFileUpload({
    onUploadFiles,
    setIsDragOverSidebar
  })

  const { renderMenuItems } = useNotesMenu({
    renamingNodeIds,
    onCreateNote,
    onCreateFolder,
    onRenameNode,
    onToggleStar,
    onDeleteNode,
    onSelectNode,
    handleStartEdit,
    handleAutoRename,
    activeNode
  })

  const searchOptions = useMemo(
    () => ({
      debounceMs: 300,
      maxResults: 100,
      contextLength: 50,
      caseSensitive: false,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      enabled: isShowSearch
    }),
    [isShowSearch]
  )

  const {
    search,
    cancel,
    reset,
    isSearching,
    results: searchResults,
    stats: searchStats
  } = useFullTextSearch(searchOptions)

  useEffect(() => {
    if (!isShowSearch) {
      reset()
      return
    }

    if (hasSearchKeyword) {
      search(searchableNodes, trimmedSearchKeyword)
    } else {
      reset()
    }
  }, [hasSearchKeyword, isShowSearch, reset, search, searchableNodes, trimmedSearchKeyword])

  // --- Logic ---

  const handleCreateFolder = useCallback(() => {
    if (showFavoritesOnly) {
      setShowFavoritesOnly(false)
    }
    setGroupExpanded((prev) => (prev['my-library'] ? prev : { ...prev, 'my-library': true }))
    onCreateFolder(t('notes.untitled_folder'))
  }, [onCreateFolder, setShowFavoritesOnly, showFavoritesOnly, t])

  const handleCreateNote = useCallback(() => {
    if (showFavoritesOnly) {
      setShowFavoritesOnly(false)
    }
    setGroupExpanded((prev) => (prev['my-library'] ? prev : { ...prev, 'my-library': true }))
    onCreateNote(t('notes.untitled_note'))
  }, [onCreateNote, setShowFavoritesOnly, showFavoritesOnly, t])

  const handleSelectSortType = useCallback(
    (selectedSortType: NotesSortType) => {
      onSortNodes(selectedSortType)
    },
    [onSortNodes]
  )

  const handleToggleFavoritesFilter = useCallback(() => {
    setShowFavoritesOnly(!showFavoritesOnly)
  }, [setShowFavoritesOnly, showFavoritesOnly])

  const renderSortMenu = () => (
    <MenuList className="gap-1">
      {sortMenuItems.map((item) =>
        'type' in item ? (
          <MenuDivider key={item.key} />
        ) : (
          <MenuItem
            key={item.key}
            label={item.label}
            active={sortType === item.key}
            suffix={sortType === item.key ? <Check size={16} className="text-foreground" /> : undefined}
            onClick={() => {
              handleSelectSortType(item.key)
              setSortOpen(false)
            }}
          />
        )
      )}
    </MenuList>
  )

  const renderEmptyAreaMenuItems = () => (
    <>
      <ContextMenuItem onSelect={handleCreateNote}>
        <ContextMenuItemContent icon={<FilePlus size={14} />}>{t('notes.new_note')}</ContextMenuItemContent>
      </ContextMenuItem>
      <ContextMenuItem onSelect={handleCreateFolder}>
        <ContextMenuItemContent icon={<Folder size={14} />}>{t('notes.new_folder')}</ContextMenuItemContent>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={handleSelectFiles}>
        <ContextMenuItemContent icon={<Upload size={14} />}>{t('notes.upload_files')}</ContextMenuItemContent>
      </ContextMenuItem>
      <ContextMenuItem onSelect={handleSelectFolder}>
        <ContextMenuItemContent icon={<FolderUp size={14} />}>{t('notes.upload_folder')}</ContextMenuItemContent>
      </ContextMenuItem>
    </>
  )

  // Flatten tree nodes for virtualization.
  const flattenedNodes = useMemo<VirtualListItem[]>(() => {
    const flattenForVirtualization = (nodes: NotesTreeNode[], depth: number = 0): VirtualListItem[] => {
      let result: VirtualListItem[] = []
      for (const node of nodes) {
        result.push({ kind: 'node', node, depth })
        if (node.type === 'folder' && node.expanded && node.children && node.children.length > 0) {
          result = [...result, ...flattenForVirtualization(node.children, depth + 1)]
        }
      }
      return result
    }

    if (isShowSearch) {
      if (hasSearchKeyword) {
        return searchResults.map<VirtualListItem>((result) => ({ kind: 'node', node: result, depth: 0 }))
      }
      return []
    }

    const result: VirtualListItem[] = []

    if (showFavoritesOnly) {
      if (favoriteNotes.length === 0) {
        return [{ kind: 'favorites-empty', hint: t('notes.favorites_empty_hint') }]
      }
      return favoriteNotes.map<VirtualListItem>((node) => ({ kind: 'node', node, depth: 0 }))
    }

    const libraryNodes = flattenForVirtualization(notesTree)
    result.push({
      kind: 'group-header',
      groupId: 'my-library',
      label: t('notes.my_library'),
      count: notesTree.length,
      expanded: groupExpanded['my-library']
    })
    if (groupExpanded['my-library']) {
      result.push(...libraryNodes)
    }

    return result
  }, [favoriteNotes, groupExpanded, hasSearchKeyword, isShowSearch, notesTree, searchResults, showFavoritesOnly, t])

  // Scroll to active node
  useEffect(() => {
    if (activeNode?.id && !isShowSearch && !showFavoritesOnly && virtualListRef.current) {
      const timer = setTimeout(() => {
        const activeIndex = flattenedNodes.findIndex((item) => item.kind === 'node' && item.node.id === activeNode.id)
        if (activeIndex !== -1) {
          virtualListRef.current?.scrollToIndex(activeIndex, {
            align: 'center',
            behavior: 'auto'
          })
        }
      }, 200)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [activeNode?.id, flattenedNodes, isShowSearch, showFavoritesOnly])

  const isSticky = useCallback(
    (index: number) => {
      const item = flattenedNodes[index]
      if (!item || isShowSearch || showFavoritesOnly) return false
      if (item.kind === 'group-header') return true
      if (item.kind === 'node') return item.node.type === 'folder'
      return false
    },
    [flattenedNodes, isShowSearch, showFavoritesOnly]
  )

  // Depth for hierarchical sticky positioning. Group headers sit at depth 0; nodes at item.depth.
  const getItemDepth = useCallback(
    (index: number) => {
      const item = flattenedNodes[index]
      if (!item) return 0
      if (item.kind === 'node') return item.depth
      return 0
    },
    [flattenedNodes]
  )

  const actionsValue = useMemo(
    () => ({
      renderMenuItems,
      onSelectNode,
      onToggleExpanded
    }),
    [renderMenuItems, onSelectNode, onToggleExpanded]
  )

  const selectionValue = useMemo(
    () => ({
      selectedFolderId,
      activeNodeId: activeNode?.id
    }),
    [selectedFolderId, activeNode?.id]
  )

  const editingValue = useMemo(
    () => ({
      editingNodeId,
      renamingNodeIds,
      newlyRenamedNodeIds,
      inPlaceEdit
    }),
    [editingNodeId, renamingNodeIds, newlyRenamedNodeIds, inPlaceEdit]
  )

  const dragValue = useMemo(
    () => ({
      draggedNodeId,
      dragOverNodeId,
      dragPosition,
      onDragStart: handleDragStart,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
      onDragEnd: handleDragEnd
    }),
    [
      draggedNodeId,
      dragOverNodeId,
      dragPosition,
      handleDragStart,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handleDragEnd
    ]
  )

  const searchValue = useMemo(
    () => ({
      searchKeyword: isShowSearch ? trimmedSearchKeyword : '',
      showMatches: isShowSearch
    }),
    [isShowSearch, trimmedSearchKeyword]
  )

  return (
    <NotesActionsContext value={actionsValue}>
      <NotesSelectionContext value={selectionValue}>
        <NotesEditingContext value={editingValue}>
          <NotesDragContext value={dragValue}>
            <NotesSearchContext value={searchValue}>
              <div
                className="relative isolate flex h-full min-h-0 w-55 min-w-55 flex-col text-sidebar-foreground [border-right:0.5px_solid_var(--color-border-muted)]"
                onDragOver={(e) => {
                  e.preventDefault()
                  if (!draggedNodeId && !showFavoritesOnly) {
                    setIsDragOverSidebar(true)
                  }
                }}
                onDragLeave={() => setIsDragOverSidebar(false)}
                onDrop={(e) => {
                  if (!draggedNodeId && !showFavoritesOnly) {
                    void handleDropFiles(e)
                  }
                }}>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
                  <div className="mb-3 flex items-center gap-1">
                    <div className="relative min-w-0 flex-1">
                      <Search
                        size={14}
                        className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-foreground-muted"
                      />
                      <Input
                        placeholder={t('knowledge.search_placeholder')}
                        value={searchKeyword}
                        onChange={(e) => {
                          const keyword = e.target.value
                          setSearchKeyword(keyword)
                          setIsShowSearch(keyword.trim().length > 0)
                        }}
                        className="h-8 rounded-[10px] border-border-muted bg-background pr-8 pl-8 text-sm shadow-none"
                      />
                      {searchKeyword && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="-translate-y-1/2 absolute top-1/2 right-1 size-5 rounded-md p-0 text-foreground-muted shadow-none hover:text-foreground"
                          onClick={() => {
                            setSearchKeyword('')
                            setIsShowSearch(false)
                          }}
                          aria-label={t('common.clear')}>
                          <X size={13} />
                        </Button>
                      )}
                    </div>
                    <Tooltip
                      content={showFavoritesOnly ? t('notes.back_to_library') : t('notes.view_favorites')}
                      delay={800}
                      classNames={iconTooltipClassNames}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className={cn(
                          'size-8 shrink-0 rounded-[10px] border border-border-muted bg-background text-foreground shadow-none hover:border-border-hover hover:bg-muted/30',
                          showFavoritesOnly && 'bg-secondary'
                        )}
                        onClick={(e) => {
                          e.currentTarget.blur()
                          handleToggleFavoritesFilter()
                        }}
                        aria-label={showFavoritesOnly ? t('notes.back_to_library') : t('notes.view_favorites')}
                        aria-pressed={showFavoritesOnly}>
                        <Star className={cn('size-3.5', showFavoritesOnly && 'fill-current')} />
                      </Button>
                    </Tooltip>
                  </div>
                  <div className="mb-3 flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 min-h-8 flex-1 rounded-[10px] border border-border-muted bg-background text-foreground shadow-none hover:border-border-hover hover:bg-muted/30"
                      onClick={(e) => {
                        e.currentTarget.blur()
                        handleCreateNote()
                      }}>
                      <Plus className="size-3.5" />
                      {t('notes.new_note')}
                    </Button>
                    <Tooltip content={t('notes.new_folder')} delay={800} classNames={iconTooltipClassNames}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-8 shrink-0 rounded-[10px] border border-border-muted bg-background text-foreground shadow-none hover:border-border-hover hover:bg-muted/30"
                        onClick={(e) => {
                          e.currentTarget.blur()
                          handleCreateFolder()
                        }}
                        aria-label={t('notes.new_folder')}>
                        <FolderPlus className="size-3.5" />
                      </Button>
                    </Tooltip>
                  </div>
                  {isShowSearch && isSearching && (
                    <div className="mb-2 flex h-8 items-center gap-2 rounded-[10px] bg-sidebar-accent px-3 text-sidebar-foreground/70 text-xs">
                      <Loader2 size={14} className="animate-spin" />
                      <span>{t('notes.search.searching')}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto rounded-md text-sidebar-foreground/70 shadow-none hover:text-sidebar-foreground active:scale-95"
                        onClick={cancel}
                        aria-label={t('common.cancel')}>
                        <X size={14} />
                      </Button>
                    </div>
                  )}
                  {isShowSearch && !isSearching && hasSearchKeyword && searchStats.total > 0 && (
                    <div className="mb-2 flex h-8 items-center gap-2 rounded-[10px] bg-sidebar-accent px-3 text-sidebar-foreground/70 text-xs">
                      <span>
                        {t('notes.search.found_results', {
                          count: searchStats.total,
                          nameCount: searchStats.fileNameMatches,
                          contentCount: searchStats.contentMatches + searchStats.bothMatches
                        })}
                      </span>
                    </div>
                  )}
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <DynamicVirtualList
                        ref={virtualListRef}
                        list={flattenedNodes}
                        estimateSize={() => 28}
                        itemContainerStyle={{ padding: '0 0 4px 0' }}
                        overscan={10}
                        isSticky={isSticky}
                        getItemDepth={getItemDepth}>
                        {(item) => {
                          if (item.kind === 'group-header') {
                            return (
                              <SidebarGroupHeader
                                label={item.label}
                                count={item.count}
                                expanded={item.expanded}
                                onToggle={() => toggleGroup(item.groupId)}
                                actions={
                                  item.groupId === 'my-library' ? (
                                    <Popover open={sortOpen} onOpenChange={setSortOpen}>
                                      <PopoverTrigger asChild>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-sm"
                                          className="size-6 rounded-md text-foreground-muted shadow-none hover:bg-sidebar-accent hover:text-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-foreground"
                                          aria-label={t('assistants.presets.sorting.title')}
                                          onClick={(e) => e.stopPropagation()}>
                                          <Tooltip
                                            content={t('assistants.presets.sorting.title')}
                                            delay={800}
                                            classNames={iconTooltipClassNames}>
                                            <span className="flex items-center justify-center">
                                              <ArrowUpNarrowWide size={13} />
                                            </span>
                                          </Tooltip>
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent align="end" variant="menu">
                                        {renderSortMenu()}
                                      </PopoverContent>
                                    </Popover>
                                  ) : undefined
                                }
                              />
                            )
                          }
                          if (item.kind === 'favorites-empty') {
                            return <div className="px-2.5 py-1.5 text-foreground-muted text-xs italic">{item.hint}</div>
                          }
                          return <TreeNode node={item.node} depth={item.depth} renderChildren={false} />
                        }}
                      </DynamicVirtualList>
                    </ContextMenuTrigger>
                    {!showFavoritesOnly && <ContextMenuContent>{renderEmptyAreaMenuItems()}</ContextMenuContent>}
                  </ContextMenu>
                </div>

                {!showFavoritesOnly && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.blur()
                      handleSelectFiles()
                    }}
                    className="mx-3 mb-3 flex min-h-12 shrink-0 items-center rounded-md border border-border-muted border-dashed px-3 py-2 text-foreground-muted transition-colors hover:border-border-hover hover:bg-muted/30 hover:text-foreground">
                    <FilePlus size={16} className="mr-3 shrink-0" />
                    <span className="min-w-0 truncate text-xs italic">{t('notes.drop_markdown_hint')}</span>
                  </button>
                )}

                {isDragOverSidebar && !showFavoritesOnly && (
                  <div className="pointer-events-none absolute inset-0 rounded border-2 border-info border-dashed bg-info-bg/40" />
                )}
              </div>
            </NotesSearchContext>
          </NotesDragContext>
        </NotesEditingContext>
      </NotesSelectionContext>
    </NotesActionsContext>
  )
}

export default memo(NotesSidebar)
