import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useActiveNode } from '@renderer/hooks/useNotesQuery'
import NotesSidebarHeader from '@renderer/pages/notes/NotesSidebarHeader'
import { findNode } from '@renderer/services/NotesService'
import { useAppSelector } from '@renderer/store'
import { selectSortType } from '@renderer/store/note'
import type { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import type { MenuProps } from 'antd'
import { Dropdown } from 'antd'
import { FilePlus, Folder, FolderUp, Loader2, Upload, X } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import TreeNode from './components/TreeNode'
import {
  NotesActionsContext,
  NotesDragContext,
  NotesEditingContext,
  NotesSearchContext,
  NotesSelectionContext,
  NotesUIContext
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
  onSelectRoot: () => void
  onDeleteNode: (nodeId: string) => void
  onRenameNode: (nodeId: string, newName: string) => void
  onToggleExpanded: (nodeId: string) => void
  onToggleStar: (nodeId: string) => void
  onMoveNode: (sourceNodeId: string, targetNodeId: string, position: 'before' | 'after' | 'inside') => void
  onSortNodes: (sortType: NotesSortType) => void
  onUploadFiles: (files: File[]) => void
  notesTree: NotesTreeNode[]
  selectedFolderId?: string | null
  notesPath?: string
  refreshTree?: () => Promise<void>
}

const NotesSidebar: FC<NotesSidebarProps> = ({
  onCreateFolder,
  onCreateNote,
  onSelectNode,
  onSelectRoot,
  onDeleteNode,
  onRenameNode,
  onToggleExpanded,
  onToggleStar,
  onMoveNode,
  onSortNodes,
  onUploadFiles,
  notesTree,
  selectedFolderId,
  notesPath,
  refreshTree
}) => {
  const { t } = useTranslation()
  const { activeNode } = useActiveNode(notesTree)
  const isRootSelected = !selectedFolderId && !activeNode?.id
  const sortType = useAppSelector(selectSortType)

  const [isShowStarred, setIsShowStarred] = useState(false)
  const [isShowSearch, setIsShowSearch] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [isDragOverSidebar, setIsDragOverSidebar] = useState(false)
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null)

  const notesTreeRef = useRef<NotesTreeNode[]>(notesTree)
  const virtualListRef = useRef<any>(null)
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
    setIsDragOverSidebar,
    getTargetFolderPath: () => {
      if (selectedFolderId) {
        const selectedNode = findNode(notesTree, selectedFolderId)
        if (selectedNode && selectedNode.type === 'folder') {
          return selectedNode.externalPath
        }
      }
      return notesPath || ''
    },
    refreshTree
  })

  const { getMenuItems } = useNotesMenu({
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

  const getEmptyAreaMenuItems = useCallback((): MenuProps['items'] => {
    return [
      {
        label: t('notes.new_note'),
        key: 'new_note',
        icon: <FilePlus size={14} />,
        onClick: handleCreateNote
      },
      {
        label: t('notes.new_folder'),
        key: 'new_folder',
        icon: <Folder size={14} />,
        onClick: handleCreateFolder
      },
      { type: 'divider' },
      {
        label: t('notes.upload_files'),
        key: 'upload_files',
        icon: <Upload size={14} />,
        onClick: handleSelectFiles
      },
      {
        label: t('notes.upload_folder'),
        key: 'upload_folder',
        icon: <FolderUp size={14} />,
        onClick: handleSelectFolder
      }
    ]
  }, [t, handleCreateNote, handleCreateFolder, handleSelectFiles, handleSelectFolder])

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

    const normalNodes = flattenForVirtualization(notesTree)

    // Add hint-node to the end
    return [
      ...normalNodes,
      {
        node: {
          id: 'hint-node',
          name: '',
          type: 'hint' as const,
          treePath: '',
          externalPath: '',
          createdAt: '',
          updatedAt: ''
        },
        depth: 0
      }
    ]
  }, [notesTree, isShowStarred, isShowSearch, hasSearchKeyword, searchResults])

  // Scroll to active node
  useEffect(() => {
    if (activeNode?.id && !isShowStarred && !isShowSearch && virtualListRef.current) {
      setTimeout(() => {
        const activeIndex = flattenedNodes.findIndex(({ node }) => node.id === activeNode.id)
        if (activeIndex !== -1) {
          virtualListRef.current?.scrollToIndex(activeIndex, {
            align: 'center',
            behavior: 'auto'
          })
        }
      }, 200)
    }
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
      getMenuItems,
      onSelectNode,
      onToggleExpanded,
      onDropdownOpenChange: setOpenDropdownKey
    }),
    [getMenuItems, onSelectNode, onToggleExpanded]
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
              <NotesUIContext value={{ openDropdownKey }}>
                <SidebarContainer
                  $rootSelected={isRootSelected}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (!draggedNodeId) {
                      setIsDragOverSidebar(true)
                    }
                  }}
                  onDragLeave={() => setIsDragOverSidebar(false)}
                  onDrop={(e) => {
                    if (!draggedNodeId) {
                      handleDropFiles(e)
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

                  <NotesTreeContainer>
                    {isShowSearch && isSearching && (
                      <SearchStatusBar>
                        <Loader2 size={14} className="animate-spin" />
                        <span>{t('notes.search.searching')}</span>
                        <CancelButton onClick={cancel} title={t('common.cancel')}>
                          <X size={14} />
                        </CancelButton>
                      </SearchStatusBar>
                    )}
                    {isShowSearch && !isSearching && hasSearchKeyword && searchStats.total > 0 && (
                      <SearchStatusBar>
                        <span>
                          {t('notes.search.found_results', {
                            count: searchStats.total,
                            nameCount: searchStats.fileNameMatches,
                            contentCount: searchStats.contentMatches + searchStats.bothMatches
                          })}
                        </span>
                      </SearchStatusBar>
                    )}
                    <Dropdown
                      menu={{ items: getEmptyAreaMenuItems() }}
                      trigger={['contextMenu']}
                      open={openDropdownKey === 'empty-area'}
                      onOpenChange={(open) => setOpenDropdownKey(open ? 'empty-area' : null)}>
                      <DynamicVirtualList
                        ref={virtualListRef}
                        list={flattenedNodes}
                        size={0}
                        estimateSize={() => 28}
                        scrollerStyle={{ flex: 1, minHeight: 0, height: 'auto' }}
                        itemContainerStyle={{ padding: '8px 8px 0 8px' }}
                        overscan={10}
                        isSticky={isSticky}
                        getItemDepth={getItemDepth}
                        containerProps={{
                          onContextMenu: (e) => {
                            const target = e.target as HTMLElement
                            if (!target.closest('[data-index]')) {
                              onSelectRoot()
                              setOpenDropdownKey('empty-area')
                            }
                          },
                          onClick: (e) => {
                            const target = e.target as HTMLElement
                            if (!target.closest('[data-index]')) {
                              onSelectRoot()
                            }
                          }
                        }}>
                        {({ node, depth }) => (
                          <TreeNode
                            node={node}
                            depth={depth}
                            renderChildren={false}
                            onHintClick={node.type === 'hint' ? handleSelectFolder : undefined}
                          />
                        )}
                      </DynamicVirtualList>
                    </Dropdown>
                  </NotesTreeContainer>

                  {isDragOverSidebar && <DragOverIndicator />}
                </SidebarContainer>
              </NotesUIContext>
            </NotesSearchContext>
          </NotesDragContext>
        </NotesEditingContext>
      </NotesSelectionContext>
    </NotesActionsContext>
  )
}

export const SidebarContainer = styled.div<{ $rootSelected?: boolean }>`
  width: 250px;
  min-width: 250px;
  height: 100%;
  background-color: var(--color-background);
  border-right: 0.5px solid var(--color-border);
  border-bottom: 0.5px solid var(--color-border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  position: relative;
  box-shadow: ${({ $rootSelected }) => ($rootSelected ? '0 0 0 2px var(--color-primary) inset' : 'none')};
  transition: box-shadow 0.15s ease;
`

export const NotesTreeContainer = styled.div`
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
`

export const DragOverIndicator = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-color: rgba(0, 123, 255, 0.1);
  border: 2px dashed rgba(0, 123, 255, 0.6);
  border-radius: 4px;
  pointer-events: none;
`

export const DropHintText = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
  font-style: italic;
`

// 搜索相关样式
export const SearchStatusBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: var(--color-background-soft);
  border-bottom: 0.5px solid var(--color-border);
  font-size: 12px;
  color: var(--color-text-2);

  .animate-spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`

export const CancelButton = styled.button`
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background-color: transparent;
  color: var(--color-text-3);
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--color-background-mute);
    color: var(--color-text);
  }

  &:active {
    background-color: var(--color-active);
  }
`

export default memo(NotesSidebar)
