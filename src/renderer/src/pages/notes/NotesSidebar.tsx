import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@cherrystudio/ui'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { useActiveNode } from '@renderer/hooks/useNotesQuery'
import NotesSidebarHeader from '@renderer/pages/notes/NotesSidebarHeader'
import type { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import { FilePlus, Folder, FolderUp, Loader2, Upload, X } from 'lucide-react'
import type { FC } from 'react'
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
  const [isShowStarred, setIsShowStarred] = useState(false)
  const [isShowSearch, setIsShowSearch] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [isDragOverSidebar, setIsDragOverSidebar] = useState(false)

  const notesTreeRef = useRef<NotesTreeNode[]>(notesTree)
  const virtualListRef = useRef<DynamicVirtualListRef>(null)
  const trimmedSearchKeyword = useMemo(() => searchKeyword.trim(), [searchKeyword])
  const hasSearchKeyword = trimmedSearchKeyword.length > 0

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
    notesTreeRef.current = notesTree
  }, [notesTree])

  useEffect(() => {
    if (!isShowSearch) {
      reset()
      return
    }

    if (hasSearchKeyword) {
      search(notesTreeRef.current, trimmedSearchKeyword)
    } else {
      reset()
    }
  }, [isShowSearch, hasSearchKeyword, trimmedSearchKeyword, search, reset])

  // --- Logic ---

  const handleCreateFolder = useCallback(() => {
    onCreateFolder(t('notes.untitled_folder'))
  }, [onCreateFolder, t])

  const handleCreateNote = useCallback(() => {
    onCreateNote(t('notes.untitled_note'))
  }, [onCreateNote, t])

  const handleToggleStarredView = useCallback(() => {
    setIsShowStarred(!isShowStarred)
  }, [isShowStarred])

  const handleToggleSearchView = useCallback(() => {
    setIsShowSearch(!isShowSearch)
  }, [isShowSearch])

  const handleSelectSortType = useCallback(
    (selectedSortType: NotesSortType) => {
      onSortNodes(selectedSortType)
    },
    [onSortNodes]
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

  // Flatten tree nodes for virtualization and filtering
  const flattenedNodes = useMemo(() => {
    const flattenForVirtualization = (
      nodes: NotesTreeNode[],
      depth: number = 0
    ): Array<{ node: NotesTreeNode; depth: number }> => {
      let result: Array<{ node: NotesTreeNode; depth: number }> = []

      for (const node of nodes) {
        result.push({ node, depth })

        // Include children only if the folder is expanded
        if (node.type === 'folder' && node.expanded && node.children && node.children.length > 0) {
          result = [...result, ...flattenForVirtualization(node.children, depth + 1)]
        }
      }
      return result
    }

    const flattenForFiltering = (nodes: NotesTreeNode[]): NotesTreeNode[] => {
      let result: NotesTreeNode[] = []

      for (const node of nodes) {
        if (isShowStarred) {
          if (node.type === 'file' && node.isStarred) {
            result.push(node)
          }
        }
        if (node.children && node.children.length > 0) {
          result = [...result, ...flattenForFiltering(node.children)]
        }
      }
      return result
    }

    if (isShowSearch) {
      if (hasSearchKeyword) {
        return searchResults.map((result) => ({ node: result, depth: 0 }))
      }
      return [] // 搜索关键词为空
    }

    if (isShowStarred) {
      const filteredNodes = flattenForFiltering(notesTree)
      return filteredNodes.map((node) => ({ node, depth: 0 }))
    }

    return flattenForVirtualization(notesTree)
  }, [notesTree, isShowStarred, isShowSearch, hasSearchKeyword, searchResults])

  // Scroll to active node
  useEffect(() => {
    if (activeNode?.id && !isShowStarred && !isShowSearch && virtualListRef.current) {
      const timer = setTimeout(() => {
        const activeIndex = flattenedNodes.findIndex(({ node }) => node.id === activeNode.id)
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
  }, [activeNode?.id, isShowStarred, isShowSearch, flattenedNodes])

  // Determine which items should be sticky (only folders in normal view)
  const isSticky = useCallback(
    (index: number) => {
      const item = flattenedNodes[index]
      if (!item) return false

      // Only folders should be sticky, and only in normal view (not search or starred)
      return item.node.type === 'folder' && !isShowSearch && !isShowStarred
    },
    [flattenedNodes, isShowSearch, isShowStarred]
  )

  // Get the depth of an item for hierarchical sticky positioning
  const getItemDepth = useCallback(
    (index: number) => {
      const item = flattenedNodes[index]
      return item?.depth ?? 0
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
                className="relative isolate flex h-full min-h-0 w-62.5 min-w-62.5 flex-col rounded-tl-lg border-border border-r bg-background"
                onDragOver={(e) => {
                  e.preventDefault()
                  if (!draggedNodeId) {
                    setIsDragOverSidebar(true)
                  }
                }}
                onDragLeave={() => setIsDragOverSidebar(false)}
                onDrop={(e) => {
                  if (!draggedNodeId) {
                    void handleDropFiles(e)
                  }
                }}>
                <NotesSidebarHeader
                  isShowStarred={isShowStarred}
                  isShowSearch={isShowSearch}
                  searchKeyword={searchKeyword}
                  sortType={sortType}
                  onCreateFolder={handleCreateFolder}
                  onCreateNote={handleCreateNote}
                  onToggleStarredView={handleToggleStarredView}
                  onToggleSearchView={handleToggleSearchView}
                  onSetSearchKeyword={setSearchKeyword}
                  onSelectSortType={handleSelectSortType}
                />

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {isShowSearch && isSearching && (
                    <div className="flex items-center gap-2 border-border border-b bg-muted px-3 py-2 text-muted-foreground text-xs">
                      <Loader2 size={14} className="animate-spin" />
                      <span>{t('notes.search.searching')}</span>
                      <button
                        type="button"
                        className="ml-auto flex size-5 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground active:bg-accent"
                        onClick={cancel}
                        title={t('common.cancel')}>
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  {isShowSearch && !isSearching && hasSearchKeyword && searchStats.total > 0 && (
                    <div className="flex items-center gap-2 border-border border-b bg-muted px-3 py-2 text-muted-foreground text-xs">
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
                        itemContainerStyle={{ padding: '8px 8px 0 8px' }}
                        overscan={10}
                        isSticky={isSticky}
                        getItemDepth={getItemDepth}>
                        {({ node, depth }) => <TreeNode node={node} depth={depth} renderChildren={false} />}
                      </DynamicVirtualList>
                    </ContextMenuTrigger>
                    <ContextMenuContent>{renderEmptyAreaMenuItems()}</ContextMenuContent>
                  </ContextMenu>
                  {!isShowStarred && !isShowSearch && (
                    <div className="mt-1.5 mb-3 px-2">
                      <TreeNode
                        node={{
                          id: 'hint-node',
                          name: '',
                          type: 'hint',
                          treePath: '',
                          externalPath: '',
                          createdAt: '',
                          updatedAt: ''
                        }}
                        depth={0}
                        renderChildren={false}
                        onHintClick={handleSelectFolder}
                      />
                    </div>
                  )}
                </div>

                {isDragOverSidebar && (
                  <div className="pointer-events-none absolute inset-0 rounded border-2 border-primary border-dashed bg-primary/10" />
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
