import { FileTree, type FileTreeNode } from '@renderer/components/FileTree'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/features/command'
import { useActiveNode } from '@renderer/hooks/useNotesQuery'
import NotesSidebarHeader from '@renderer/pages/notes/NotesSidebarHeader'
import { findNode } from '@renderer/services/NotesTreeService'
import type { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import { FilePlus, Folder, FolderUp, Loader2, Upload, X } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useFullTextSearch } from './hooks/useFullTextSearch'
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

const collectExpandedIds = (nodes: NotesTreeNode[], result: Set<string>): Set<string> => {
  for (const node of nodes) {
    if (node.type === 'folder' && node.expanded) {
      result.add(node.id)
    }
    if (node.children?.length) {
      collectExpandedIds(node.children, result)
    }
  }
  return result
}

const toFileTreeNode = (node: NotesTreeNode, flat: boolean): FileTreeNode => ({
  id: node.id,
  name: node.name,
  kind: node.type === 'folder' ? 'folder' : 'file',
  // In flat modes (search/starred), use id as path so the tree model doesn't try to
  // reconstruct missing parent folders from hierarchical treePaths.
  path: flat ? node.id : node.treePath || node.id,
  children:
    flat || node.type !== 'folder' || !node.children?.length
      ? undefined
      : node.children.map((c) => toFileTreeNode(c, false))
})

const collectStarredFiles = (nodes: NotesTreeNode[], result: NotesTreeNode[] = []): NotesTreeNode[] => {
  for (const node of nodes) {
    if (node.type === 'file' && node.isStarred) {
      result.push(node)
    }
    if (node.children?.length) {
      collectStarredFiles(node.children, result)
    }
  }
  return result
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
  const trimmedSearchKeyword = useMemo(() => searchKeyword.trim(), [searchKeyword])
  const hasSearchKeyword = trimmedSearchKeyword.length > 0

  const { editingNodeId, renamingNodeIds, newlyRenamedNodeIds, inPlaceEdit, handleStartEdit, handleAutoRename } =
    useNotesEditing({
      onRenameNode
    })

  const { handleDropFiles, handleSelectFiles, handleSelectFolder } = useNotesFileUpload({
    onUploadFiles,
    setIsDragOverSidebar
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
      maxFileSize: 10 * 1024 * 1024,
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

  const handleCreateFolder = useCallback(() => {
    onCreateFolder(t('notes.untitled_folder'))
  }, [onCreateFolder, t])

  const handleCreateNote = useCallback(() => {
    onCreateNote(t('notes.untitled_note'))
  }, [onCreateNote, t])

  const handleToggleStarredView = useCallback(() => {
    setIsShowStarred((prev) => !prev)
  }, [])

  const handleToggleSearchView = useCallback(() => {
    setIsShowSearch((prev) => !prev)
  }, [])

  const handleSelectSortType = useCallback(
    (selectedSortType: NotesSortType) => {
      onSortNodes(selectedSortType)
    },
    [onSortNodes]
  )

  const fileTreeNodes = useMemo<FileTreeNode[]>(() => {
    if (isShowSearch) {
      if (!hasSearchKeyword) return []
      return searchResults.map((r) => toFileTreeNode(r, true))
    }
    if (isShowStarred) {
      return collectStarredFiles(notesTree).map((n) => toFileTreeNode(n, true))
    }
    return notesTree.map((n) => toFileTreeNode(n, false))
  }, [isShowSearch, hasSearchKeyword, searchResults, isShowStarred, notesTree])

  const expandedIds = useMemo<ReadonlySet<string>>(() => {
    if (isShowSearch || isShowStarred) return new Set<string>()
    return collectExpandedIds(notesTree, new Set<string>())
  }, [isShowSearch, isShowStarred, notesTree])

  const selectedId = selectedFolderId ?? activeNode?.id ?? null

  // handleSelectNode (NotesPage) already toggles expansion for folders. FileTreeRow's
  // row click fires onSelectedChange AND onExpandedChange — without dedup the folder
  // would toggle twice (net no-op). Remember the folder that selection just toggled
  // so the matching onExpandedChange call can skip it. Chevron clicks only fire
  // onExpandedChange, so they still toggle as expected.
  const pendingFolderToggleRef = useRef<string | null>(null)

  const handleFileTreeSelectedChange = useCallback(
    (id: string | null) => {
      if (!id) return
      const node = findNode(notesTreeRef.current, id)
      if (!node) return
      if (node.type === 'folder') {
        pendingFolderToggleRef.current = id
      }
      onSelectNode(node)
    },
    [onSelectNode]
  )

  const handleFileTreeExpandedChange = useCallback(
    (nextExpanded: ReadonlySet<string>) => {
      const skip = pendingFolderToggleRef.current
      pendingFolderToggleRef.current = null
      for (const id of nextExpanded) {
        if (id !== skip && !expandedIds.has(id)) {
          onToggleExpanded(id)
        }
      }
      for (const id of expandedIds) {
        if (id !== skip && !nextExpanded.has(id)) {
          onToggleExpanded(id)
        }
      }
    },
    [expandedIds, onToggleExpanded]
  )

  const renameSlot = useMemo(
    () => ({
      isRenaming: (node: FileTreeNode) => editingNodeId === node.id && inPlaceEdit.isEditing,
      inputProps: inPlaceEdit.inputProps
    }),
    [editingNodeId, inPlaceEdit.isEditing, inPlaceEdit.inputProps]
  )

  const animationSlot = useMemo(
    () => ({
      isAnimating: (node: FileTreeNode) => renamingNodeIds.has(node.id),
      isNewlyRenamed: (node: FileTreeNode) => newlyRenamedNodeIds.has(node.id)
    }),
    [renamingNodeIds, newlyRenamedNodeIds]
  )

  const renderRowExtras = useCallback(
    (node: FileTreeNode) => {
      if (!isShowSearch) return null
      const result = searchResults.find((r) => r.id === node.id)
      if (!result || !result.matchType || result.matchType === 'filename') return null
      const label = result.matchType === 'both' ? t('notes.search.both') : t('notes.search.content')
      return (
        <span
          className={
            result.matchType === 'both'
              ? 'inline-flex h-4 shrink-0 items-center rounded-xs bg-secondary px-1 font-medium text-secondary-foreground text-xs leading-none'
              : 'inline-flex h-4 shrink-0 items-center rounded-xs bg-muted px-1 font-medium text-muted-foreground text-xs leading-none'
          }>
          {label}
        </span>
      )
    },
    [isShowSearch, searchResults, t]
  )

  const getTreeNodeMenuItems = useCallback(
    (node: FileTreeNode): readonly CommandContextMenuExtraItem[] => {
      const treeNode = findNode(notesTreeRef.current, node.id)
      if (!treeNode) return []
      return getMenuItems(treeNode)
    },
    [getMenuItems]
  )

  const handleMove = useCallback(
    (sourceId: string, targetId: string, position: 'before' | 'after' | 'inside') => {
      onMoveNode(sourceId, targetId, position)
    },
    [onMoveNode]
  )

  const emptyAreaMenuItems = useMemo<CommandContextMenuExtraItem[]>(
    () => [
      {
        type: 'item',
        id: 'notes.new-note',
        label: t('notes.new_note'),
        icon: <FilePlus size={14} />,
        onSelect: handleCreateNote
      },
      {
        type: 'item',
        id: 'notes.new-folder',
        label: t('notes.new_folder'),
        icon: <Folder size={14} />,
        onSelect: handleCreateFolder
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'notes.upload-files',
        label: t('notes.upload_files'),
        icon: <Upload size={14} />,
        onSelect: handleSelectFiles
      },
      {
        type: 'item',
        id: 'notes.upload-folder',
        label: t('notes.upload_folder'),
        icon: <FolderUp size={14} />,
        onSelect: handleSelectFolder
      }
    ],
    [t, handleCreateNote, handleCreateFolder, handleSelectFiles, handleSelectFolder]
  )

  return (
    <div
      className="relative isolate flex h-full min-h-0 w-62.5 min-w-62.5 flex-col rounded-tl-lg border-border border-r bg-background"
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragOverSidebar(true)
      }}
      onDragLeave={() => setIsDragOverSidebar(false)}
      onDrop={(e) => {
        void handleDropFiles(e)
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

        <div className="min-h-0 flex-1 px-2 pt-2">
          <CommandContextMenu location="webcontents.context" extraItems={emptyAreaMenuItems}>
            <div className="h-full min-h-0">
              <FileTree
                nodes={fileTreeNodes}
                expandedIds={expandedIds}
                onExpandedChange={handleFileTreeExpandedChange}
                selectedId={selectedId}
                onSelectedChange={handleFileTreeSelectedChange}
                onMove={handleMove}
                renameSlot={renameSlot}
                animationSlot={animationSlot}
                renderRowExtras={renderRowExtras}
                getMenuItems={getTreeNodeMenuItems}
              />
            </div>
          </CommandContextMenu>
        </div>

        {!isShowStarred && !isShowSearch && (
          <div
            className="mt-1.5 mb-3 flex cursor-pointer items-center gap-2 px-3.5 py-1 text-muted-foreground text-xs italic hover:text-foreground"
            onClick={handleSelectFolder}>
            <FilePlus size={14} className="shrink-0" />
            <span>{t('notes.drop_markdown_hint')}</span>
          </div>
        )}
      </div>

      {isDragOverSidebar && (
        <div className="pointer-events-none absolute inset-0 rounded border-2 border-primary border-dashed bg-primary/10" />
      )}
    </div>
  )
}

export default memo(NotesSidebar)
