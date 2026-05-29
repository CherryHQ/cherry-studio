import { loggerService } from '@logger'
import type { CodeEditorHandles } from '@renderer/components/CodeEditor'
import type { RichEditorRef } from '@renderer/components/RichEditor/types'
import { useCache } from '@renderer/data/hooks/useCache'
import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { useNote } from '@renderer/hooks/useNote'
import { useActiveNode, useFileContent, useFileContentSync } from '@renderer/hooks/useNotesQuery'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useShowWorkspace } from '@renderer/hooks/useShowWorkspace'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import {
  addDir,
  addNote,
  delNode,
  projectNotesTree,
  renameNode as renameEntry,
  resolveNotesPath,
  sortTree,
  uploadNotes
} from '@renderer/services/NotesService'
import {
  findNode,
  findNodeByPath,
  findParent,
  normalizePathValue,
  reorderTreeNodes,
  updateTreeNode
} from '@renderer/services/NotesTreeService'
import type { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import type { Note } from '@shared/data/types/note'
import type { DirectoryTreeOptions } from '@shared/file/types'
import { debounce } from 'lodash'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import HeaderNavbar from './HeaderNavbar'
import NotesEditor from './NotesEditor'
import NotesSidebar from './NotesSidebar'

const logger = loggerService.withContext('NotesPage')
const SAVE_FAILURE_TOAST_INTERVAL_MS = 5000

const NOTES_TREE_OPTIONS: DirectoryTreeOptions = {
  // Notes ships only `.md` files. Stats fuel `sortType: sort_updated_*` /
  // `sort_created_*`. We deliberately ignore `.gitignore` — the notes root
  // is the user's working directory, not a git-versioned repo.
  extensions: ['.md'],
  respectGitignore: false,
  includeHidden: false,
  withStats: true
}

type NoteMetadataSnapshot = Pick<Note, 'path' | 'isStarred' | 'isExpanded'>

const NotesPage: FC = () => {
  const editorRef = useRef<RichEditorRef>(null)
  const codeEditorRef = useRef<CodeEditorHandles>(null)
  const { t } = useTranslation()
  const { showWorkspace } = useShowWorkspace()
  const [activeFilePath, setActiveFilePath] = useCache('notes.active_file_path')
  const { settings, notesPath, updateNotesPath, sortType, updateSortType } = useNotesSettings()
  const { noteByPath, patchNode, removePath, rewritePath } = useNote(notesPath)

  // `useDirectoryTree` owns the FS scan + chokidar watcher behind a single
  // `File_TreeCreate` IPC. Whenever the watcher observes add / unlink / rename
  // events, `root` (mutated in place) + `version` (tick) drive the
  // projection effect below to refresh `notesTree`.
  const {
    root: treeRoot,
    version: treeVersion,
    treeId,
    error: treeError
  } = useDirectoryTree(notesPath || undefined, NOTES_TREE_OPTIONS)

  // Surface tree-create failures (missing ripgrep, EACCES on the notes
  // folder, deleted root). Without this, the user sees a silently-empty
  // tree with no toast and no log a non-developer would notice.
  useEffect(() => {
    if (!treeError) return
    logger.error('Failed to load notes directory tree', treeError, { notesPath, treeId })
    window.toast.error(t('notes.tree_load_failed'))
  }, [treeError, notesPath, treeId, t])

  // 混合策略：useLiveQuery用于笔记树，React Query用于文件内容
  const [notesTree, setNotesTree] = useState<NotesTreeNode[]>([])
  const noteByPathRef = useRef(noteByPath)
  const { activeNode } = useActiveNode(notesTree, activeFilePath)
  const { invalidateFileContent } = useFileContentSync()
  const { data: currentContent = '', error: currentContentError } = useFileContent(activeFilePath)
  const contentLoadError = activeFilePath ? currentContentError : undefined

  const [tokenCount, setTokenCount] = useState(0)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const lastContentRef = useRef<string>('')
  const lastFilePathRef = useRef<string | undefined>(undefined)
  const lastSaveFailureToastAtRef = useRef(0)
  const isRenamingRef = useRef(false)
  const isCreatingNoteRef = useRef(false)
  const pendingScrollRef = useRef<{ lineNumber: number; lineContent?: string } | null>(null)

  const activeFilePathRef = useRef<string | undefined>(activeFilePath)
  const currentContentRef = useRef(currentContent)
  const contentLoadErrorRef = useRef<Error | undefined>(contentLoadError as Error | undefined)

  const mergeTreeState = useCallback((nodes: NotesTreeNode[]): NotesTreeNode[] => {
    return nodes.map((node) => {
      const normalizedPath = normalizePathValue(node.externalPath)
      const currentNote = noteByPathRef.current.get(normalizedPath)
      const merged: NotesTreeNode = {
        ...node,
        externalPath: normalizedPath,
        isStarred: currentNote?.isStarred ?? false
      }

      if (node.type === 'folder') {
        merged.expanded = currentNote?.isExpanded ?? false
        merged.children = node.children ? mergeTreeState(node.children) : []
      }

      return merged
    })
  }, [])

  // Project the FS tree (from `useDirectoryTree`) into the legacy
  // `NotesTreeNode[]` shape every time the FS changes — watcher events
  // bump `treeVersion`, the user toggling sort changes `sortType`, and
  // the initial mount triggers when `treeRoot` first becomes non-null.
  useEffect(() => {
    if (!treeRoot || !notesPath) {
      setNotesTree([])
      return
    }
    const projected = projectNotesTree(treeRoot, notesPath)
    const sorted = sortTree(projected, sortType)
    setNotesTree(mergeTreeState(sorted))
    // `treeVersion` participates so that watcher-driven mutations re-derive
    // the projection even though `treeRoot` is the same object identity.
  }, [treeRoot, treeVersion, notesPath, sortType, mergeTreeState])

  // Re-merge tree state when note metadata changes
  useEffect(() => {
    noteByPathRef.current = noteByPath
    if (notesTree.length > 0) {
      setNotesTree((prev) => mergeTreeState(prev))
    }
  }, [mergeTreeState, noteByPath, notesTree.length])

  useEffect(() => {
    const textContent = editorRef.current?.getContent() || currentContent
    const plainText = textContent.replace(/<[^>]*>/g, '')
    setTokenCount(plainText.length)
  }, [currentContent])

  // 保存当前笔记内容
  const saveCurrentNote = useCallback(
    async (content: string, filePath?: string) => {
      const targetPath = filePath || activeFilePath
      if (!targetPath || content.trim() === currentContent.trim()) return
      if (contentLoadErrorRef.current && targetPath === activeFilePathRef.current) {
        logger.warn('Skipped note save because current file content failed to load', { targetPath })
        window.toast.error(t('notes.save_blocked_load_failed'))
        return
      }

      try {
        await window.api.file.write(targetPath, content)
        // 保存后立即刷新缓存，确保下次读取时获取最新内容
        invalidateFileContent(targetPath)
      } catch (error) {
        logger.error('Failed to save note:', error as Error)
        const now = Date.now()
        if (now - lastSaveFailureToastAtRef.current > SAVE_FAILURE_TOAST_INTERVAL_MS) {
          lastSaveFailureToastAtRef.current = now
          window.toast.error(t('notes.save_failed'))
        }
      }
    },
    [activeFilePath, currentContent, invalidateFileContent, t]
  )

  // `useDirectoryTree` owns the FS scan + watcher pipeline now. We keep a
  // hook-stable identity for `refreshTree` so all the rollback paths /
  // optimistic-update recovery branches below can hold it in their
  // dependency arrays unchanged — the actual tree refresh happens
  // automatically via the projection effect every time the watcher
  // observes a mutation.
  const refreshTree = useCallback(async (): Promise<void> => {
    /* no-op — see comment above */
  }, [])

  const saveCurrentNoteRef = useRef(saveCurrentNote)
  // Stable debounce instance constructed once. Reads the latest
  // `saveCurrentNote` via `saveCurrentNoteRef` so a SWR revalidation that
  // changes `saveCurrentNote`'s identity does NOT rebuild the debouncer —
  // rebuilding would fire any pending timer through a stale closure and
  // skip the write when the new SWR `currentContent` matches `content`.
  const debouncedSaveRef =
    useRef<ReturnType<typeof debounce<(content: string, filePath: string | undefined) => void>>>(undefined)
  if (!debouncedSaveRef.current) {
    debouncedSaveRef.current = debounce((content: string, filePath: string | undefined) => {
      void saveCurrentNoteRef.current(content, filePath)
    }, 800) // 800ms 防抖延迟
  }
  const invalidateFileContentRef = useRef(invalidateFileContent)

  const handleMarkdownChange = useCallback(
    (newMarkdown: string) => {
      if (contentLoadError) {
        logger.warn('Ignored note edit because current file content failed to load', { activeFilePath })
        window.toast.error(t('notes.save_blocked_load_failed'))
        return
      }
      // 记录最新内容和文件路径，用于兜底保存
      lastContentRef.current = newMarkdown
      lastFilePathRef.current = activeFilePath
      // 捕获当前文件路径，避免在防抖执行时文件路径已改变的竞态条件
      debouncedSaveRef.current?.(newMarkdown, activeFilePath)
    },
    [activeFilePath, contentLoadError, t]
  )

  useEffect(() => {
    activeFilePathRef.current = activeFilePath
  }, [activeFilePath])

  useEffect(() => {
    currentContentRef.current = currentContent
  }, [currentContent])

  useEffect(() => {
    contentLoadErrorRef.current = contentLoadError as Error | undefined
  }, [contentLoadError])

  useEffect(() => {
    if (contentLoadError) {
      logger.error('Failed to load note content:', contentLoadError)
      window.toast.error(t('notes.load_failed'))
    }
  }, [contentLoadError, t])

  useEffect(() => {
    saveCurrentNoteRef.current = saveCurrentNote
  }, [saveCurrentNote])

  useEffect(() => {
    invalidateFileContentRef.current = invalidateFileContent
  }, [invalidateFileContent])

  useEffect(() => {
    async function initialize() {
      if (!notesPath) {
        // 首次启动，获取默认路径
        const info = await window.api.getAppInfo()
        const defaultPath = info.notesPath
        updateNotesPath(defaultPath)
        return
      }

      // 验证路径是否有效（处理跨平台恢复场景）
      try {
        const resolved = await resolveNotesPath(notesPath)
        if (!resolved.isFallback) {
          return
        }
        const defaultPath = resolved.path

        logger.warn('Invalid notes path detected, resetting to default', {
          previousPath: notesPath,
          defaultPath
        })

        // 重置为默认路径
        updateNotesPath(defaultPath)

        // 检查默认路径下是否有笔记文件
        try {
          const entries = await window.api.file.listDirectory(defaultPath, {
            recursive: false,
            includeFiles: true,
            includeDirectories: true
          })
          if (!entries || entries.length === 0) {
            // 默认目录为空，提示用户需要迁移文件
            window.toast.warning({
              title: t('notes.crossPlatformRestoreWarning', { path: defaultPath }),
              timeout: 10000
            })
          }
        } catch (error) {
          // 目录不存在或读取失败，会由 FileStorage 自动创建
          logger.debug('Default notes directory will be created', { error })
        }
      } catch (error) {
        logger.error('Failed to validate notes path:', error as Error)
      }
    }

    void initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesPath])

  // 处理树同步时的状态管理
  useEffect(() => {
    if (notesTree.length === 0) return
    // 如果有activeFilePath但找不到对应节点，清空选择
    // 但要排除正在同步树结构、重命名或创建笔记的情况，避免在这些操作中误清空
    const shouldClearPath = activeFilePath && !activeNode && !isRenamingRef.current && !isCreatingNoteRef.current

    if (shouldClearPath) {
      logger.warn('Clearing activeFilePath - node not found in tree', {
        activeFilePath,
        reason: 'Node not found in current tree'
      })
      setActiveFilePath(undefined)
    }
  }, [notesTree, activeFilePath, activeNode, setActiveFilePath])

  // Clear create/rename suppression once the new node appears in the tree.
  // Replaces a 500ms timer that could race chokidar on slow filesystems
  // (iCloud Drive, NFS, virtualized FS) and silently deselect a fresh note.
  useEffect(() => {
    if (activeNode) {
      isCreatingNoteRef.current = false
      isRenamingRef.current = false
    }
  }, [activeNode])

  // Active-file content invalidation when the watcher reports a `change`
  // on the file the user is currently viewing — pipes through
  // `useDirectoryTree`'s mutation stream is overkill (it would re-project
  // the entire tree on every keystroke save), so we listen to the same
  // chokidar events via a tiny `File_TreeMutation` side-subscriber instead.
  // The unlink → clear-active-file path is implicit: when the file leaves
  // the tree, the `shouldClearPath` guard above clears `activeFilePath`.
  useEffect(() => {
    if (!notesPath || !treeId) return
    const unsubscribe = window.api.tree.onMutation((payload) => {
      // File_TreeMutation is a shared channel — ignore payloads from other trees.
      if (payload.treeId !== treeId) return
      // Best-effort: any `updated` event for the active file triggers a
      // content-cache invalidation so the renderer re-reads from disk.
      if (payload.event.type !== 'updated') return
      const activePath = activeFilePathRef.current
      if (!activePath) return
      const normalized = normalizePathValue(payload.event.path)
      if (normalizePathValue(activePath) === normalized) {
        invalidateFileContentRef.current?.(normalized)
      }
    })
    return () => {
      unsubscribe()
    }
  }, [notesPath, treeId])

  // Emergency-save the in-flight edit if the page unmounts while the
  // debounced writer hasn't flushed.
  useEffect(() => {
    return () => {
      if (lastContentRef.current && lastFilePathRef.current && lastContentRef.current !== currentContentRef.current) {
        const saveFn = saveCurrentNoteRef.current
        if (saveFn) {
          saveFn(lastContentRef.current, lastFilePathRef.current).catch((error) => {
            logger.error('Emergency save failed:', error as Error)
          })
        }
      }
      debouncedSaveRef.current?.cancel()
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !currentContent) return
    // 获取编辑器当前内容
    const editorMarkdown = editor.getMarkdown()

    // 只有当编辑器内容与期望内容不一致时才更新
    // 这样既能处理初始化，也能处理后续的内容同步，还能避免光标跳动
    if (editorMarkdown !== currentContent) {
      editor.setMarkdown(currentContent)
    }
  }, [currentContent, activeFilePath])

  // Execute pending scroll after file switch
  useEffect(() => {
    if (!pendingScrollRef.current || !currentContent) return

    const { lineNumber, lineContent } = pendingScrollRef.current
    pendingScrollRef.current = null

    // Wait for DOM to update before scrolling
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const codeEditor = codeEditorRef.current
        const richEditor = editorRef.current

        try {
          if (codeEditor?.scrollToLine) {
            codeEditor.scrollToLine(lineNumber, { highlight: true })
          } else if (richEditor?.scrollToLine) {
            richEditor.scrollToLine(lineNumber, { highlight: true, lineContent })
          }
        } catch (error) {
          logger.error('Failed to execute pending scroll:', error as Error)
        }
      })
    })
  }, [activeFilePath, currentContent])

  // 切换文件时的清理工作
  useEffect(() => {
    return () => {
      // 保存之前文件的内容
      if (lastContentRef.current && lastFilePathRef.current) {
        saveCurrentNote(lastContentRef.current, lastFilePathRef.current).catch((error) => {
          logger.error('Emergency save before file switch failed:', error as Error)
        })
      }

      // 取消防抖保存并清理状态
      debouncedSaveRef.current?.cancel()
      lastContentRef.current = ''
      lastFilePathRef.current = undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath])

  // 获取目标文件夹路径（选中文件夹或根目录）
  const getTargetFolderPath = useCallback(
    (targetFolderId?: string) => {
      const folderId = targetFolderId || selectedFolderId
      if (folderId) {
        const selectedNode = findNode(notesTree, folderId)
        if (selectedNode && selectedNode.type === 'folder') {
          return selectedNode.externalPath
        }
      }
      return notesPath // 默认返回根目录
    },
    [selectedFolderId, notesTree, notesPath]
  )

  const persistMetadataPatch = useCallback(
    (node: NotesTreeNode, patch: Parameters<typeof patchNode>[1]) => {
      void patchNode(node, patch).catch((error) => {
        logger.error('Failed to persist note patch:', error as Error)
        window.toast.error(t('notes.metadata_update_failed'))
        void refreshTree().catch((refreshError) => {
          logger.error('Failed to refresh notes tree after metadata patch failure:', refreshError as Error)
        })
      })
    },
    [patchNode, refreshTree, t]
  )

  const getMetadataSnapshot = useCallback((path: string, recursive: boolean): NoteMetadataSnapshot[] => {
    const normalizedPath = normalizePathValue(path)
    const prefix = `${normalizedPath}/`

    return [...noteByPathRef.current.values()]
      .filter((note) => note.path === normalizedPath || (recursive && note.path.startsWith(prefix)))
      .map((note) => ({
        path: note.path,
        isStarred: note.isStarred,
        isExpanded: note.isExpanded
      }))
  }, [])

  const restoreMetadataSnapshot = useCallback(
    async (snapshot: NoteMetadataSnapshot[]) => {
      await Promise.all(
        snapshot.map((note) =>
          patchNode(
            {
              externalPath: note.path,
              type: note.isExpanded ? 'folder' : 'file'
            },
            {
              isStarred: note.isStarred,
              isExpanded: note.isExpanded
            }
          )
        )
      )
    },
    [patchNode]
  )

  const rollbackFileMove = useCallback(async (fromPath: string, toPath: string, nodeType: NotesTreeNode['type']) => {
    if (nodeType === 'folder') {
      await window.api.file.moveDir(fromPath, toPath)
      return
    }
    await window.api.file.move(fromPath, toPath)
  }, [])

  const syncMetadataAfterFileOperation = useCallback(
    async (operation: () => Promise<void>, rollback?: () => Promise<void>) => {
      try {
        await operation()
        return true
      } catch (error) {
        logger.error('Failed to sync note metadata after file operation:', error as Error)
        if (rollback) {
          try {
            await rollback()
          } catch (rollbackError) {
            logger.error('Failed to rollback note file operation after metadata sync failure:', rollbackError as Error)
          }
        }
        window.toast.error(t('notes.metadata_sync_failed'))
        await refreshTree()
        return false
      }
    },
    [refreshTree, t]
  )

  const setFolderExpandedByPath = useCallback(
    (folderPath: string, expanded: boolean) => {
      const folderNode = findNodeByPath(notesTree, normalizePathValue(folderPath))
      if (folderNode?.type !== 'folder') {
        return
      }

      setNotesTree((prev) => updateTreeNode(prev, folderNode.id, (current) => ({ ...current, expanded })))
      persistMetadataPatch(folderNode, { isExpanded: expanded })
    },
    [notesTree, persistMetadataPatch]
  )

  // 创建文件夹
  const handleCreateFolder = useCallback(
    async (name: string, targetFolderId?: string) => {
      try {
        const targetPath = getTargetFolderPath(targetFolderId)
        if (!targetPath) {
          throw new Error('No folder path selected')
        }
        await addDir(name, targetPath)
        setFolderExpandedByPath(targetPath, true)
        await refreshTree()
      } catch (error) {
        logger.error('Failed to create folder:', error as Error)
        window.toast.error(t('notes.create_folder_failed'))
      }
    },
    [getTargetFolderPath, refreshTree, setFolderExpandedByPath, t]
  )

  // 创建笔记
  const handleCreateNote = useCallback(
    async (name: string, targetFolderId?: string) => {
      try {
        isCreatingNoteRef.current = true

        const targetPath = getTargetFolderPath(targetFolderId)
        if (!targetPath) {
          throw new Error('No folder path selected')
        }
        const { path: notePath } = await addNote(name, '', targetPath)
        setFolderExpandedByPath(targetPath, true)
        setActiveFilePath(notePath)
        setSelectedFolderId(null)

        await refreshTree()
        // Success: flag stays true until the watcher reports the new node
        // and the [activeNode] effect above clears it.
      } catch (error) {
        // Write failed → file will never appear → clear the flag now so
        // shouldClearPath isn't permanently suppressed.
        isCreatingNoteRef.current = false
        logger.error('Failed to create note:', error as Error)
        window.toast.error(t('notes.create_note_failed'))
      }
    },
    [getTargetFolderPath, refreshTree, setActiveFilePath, setFolderExpandedByPath, t]
  )

  const handleToggleExpanded = useCallback(
    (nodeId: string) => {
      const targetNode = findNode(notesTree, nodeId)
      if (!targetNode || targetNode.type !== 'folder') {
        return
      }

      const nextExpanded = !targetNode.expanded
      setNotesTree((prev) => updateTreeNode(prev, nodeId, (current) => ({ ...current, expanded: nextExpanded })))
      persistMetadataPatch(targetNode, { isExpanded: nextExpanded })
    },
    [notesTree, persistMetadataPatch]
  )

  const handleToggleStar = useCallback(
    (nodeId: string) => {
      const node = findNode(notesTree, nodeId)
      if (!node) {
        return
      }

      const nextStarred = !node.isStarred
      setNotesTree((prev) => updateTreeNode(prev, nodeId, (current) => ({ ...current, isStarred: nextStarred })))
      persistMetadataPatch(node, { isStarred: nextStarred })
    },
    [notesTree, persistMetadataPatch]
  )

  // 选择节点
  const handleSelectNode = useCallback(
    async (node: NotesTreeNode) => {
      if (node.type === 'file') {
        try {
          setActiveFilePath(node.externalPath)
          invalidateFileContent(node.externalPath)
          // 清除文件夹选择状态
          setSelectedFolderId(null)
        } catch (error) {
          logger.error('Failed to load note:', error as Error)
        }
      } else if (node.type === 'folder') {
        setSelectedFolderId(node.id)
        handleToggleExpanded(node.id)
      }
    },
    [handleToggleExpanded, invalidateFileContent, setActiveFilePath]
  )

  // 删除节点
  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      try {
        const nodeToDelete = findNode(notesTree, nodeId)
        if (!nodeToDelete) return

        const metadataSnapshot = getMetadataSnapshot(nodeToDelete.externalPath, nodeToDelete.type === 'folder')
        await removePath(nodeToDelete.externalPath, nodeToDelete.type === 'folder')

        try {
          await delNode(nodeToDelete)
        } catch (fileError) {
          await restoreMetadataSnapshot(metadataSnapshot)
          throw fileError
        }

        const normalizedActivePath = activeFilePath ? normalizePathValue(activeFilePath) : undefined
        const normalizedDeletePath = normalizePathValue(nodeToDelete.externalPath)
        const isActiveNode = normalizedActivePath === normalizedDeletePath
        const isActiveDescendant =
          nodeToDelete.type === 'folder' &&
          normalizedActivePath &&
          normalizedActivePath.startsWith(`${normalizedDeletePath}/`)

        if (isActiveNode || isActiveDescendant) {
          setActiveFilePath(undefined)
          editorRef.current?.clear()
        }

        await refreshTree()
      } catch (error) {
        logger.error('Failed to delete node:', error as Error)
        if (error instanceof Error && error.message) {
          window.toast.error(t('notes.delete_failed'))
        }
      }
    },
    [
      activeFilePath,
      getMetadataSnapshot,
      notesTree,
      refreshTree,
      removePath,
      restoreMetadataSnapshot,
      setActiveFilePath,
      t
    ]
  )

  // 重命名节点
  const handleRenameNode = useCallback(
    async (nodeId: string, newName: string) => {
      try {
        isRenamingRef.current = true

        const node = findNode(notesTree, nodeId)
        if (!node || node.name === newName) {
          return
        }

        const oldPath = node.externalPath
        const renamed = await renameEntry(node, newName)

        // Tell the tree primitive about the rename so it mutates the
        // existing TreeNode in place (identity preserved for downstream
        // consumers / React keys) and dedups the chokidar unlink+add that
        // follow. Best-effort: if treeId is null (hook still initializing)
        // or the IPC fails, the watcher will catch up via removed+added —
        // just without identity preservation.
        if (treeId) {
          await window.api.tree
            .rename(treeId, oldPath, renamed.path)
            .catch((err) => logger.warn('Failed to notify tree of rename', err as Error))
        }

        let nextActivePath: string | undefined

        if (node.type === 'file' && activeFilePath === oldPath) {
          debouncedSaveRef.current?.cancel()
          nextActivePath = renamed.path
        } else if (node.type === 'folder' && activeFilePath && activeFilePath.startsWith(`${oldPath}/`)) {
          const suffix = activeFilePath.slice(oldPath.length)
          debouncedSaveRef.current?.cancel()
          nextActivePath = `${renamed.path}${suffix}`
        }

        const metadataSynced = await syncMetadataAfterFileOperation(
          () => rewritePath(oldPath, renamed.path, node.type === 'folder'),
          () => rollbackFileMove(renamed.path, oldPath, node.type)
        )
        if (!metadataSynced) {
          return
        }

        if (nextActivePath) {
          lastFilePathRef.current = nextActivePath
          setActiveFilePath(nextActivePath)
        }

        await refreshTree()
        // Success: flag stays true until the watcher reports the renamed
        // node and the [activeNode] effect above clears it.
      } catch (error) {
        // Rename failed → clear the flag now so subsequent tree updates
        // aren't suppressed.
        isRenamingRef.current = false
        logger.error('Failed to rename node:', error as Error)
        window.toast.error(
          error instanceof Error && error.message.startsWith('Target name already exists')
            ? t('notes.target_name_exists')
            : t('notes.rename_failed')
        )
      }
    },
    [
      activeFilePath,
      notesTree,
      refreshTree,
      rewritePath,
      rollbackFileMove,
      setActiveFilePath,
      syncMetadataAfterFileOperation,
      t,
      treeId
    ]
  )

  // 处理文件上传
  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      try {
        if (!files || files.length === 0) {
          window.toast.warning(t('notes.no_file_selected'))
          return
        }

        const targetFolderPath = getTargetFolderPath()
        if (!targetFolderPath) {
          throw new Error('No folder path selected')
        }

        // Validate uploadNotes function is available
        if (typeof uploadNotes !== 'function') {
          logger.error('uploadNotes function is not available', { uploadNotes })
          window.toast.error(t('notes.upload_failed'))
          return
        }

        let result: Awaited<ReturnType<typeof uploadNotes>>
        try {
          result = await uploadNotes(files, targetFolderPath)
        } catch (uploadError) {
          logger.error('Upload operation failed:', uploadError as Error)
          throw uploadError
        }

        // Validate result object
        if (!result || typeof result !== 'object') {
          logger.error('Invalid upload result:', { result })
          window.toast.error(t('notes.upload_failed'))
          return
        }

        // 检查上传结果
        if (result.fileCount === 0) {
          if (result.failedFiles > 0) {
            window.toast.error(t('notes.upload_all_failed', { failed: result.failedFiles }))
            return
          }
          window.toast.warning(t('notes.no_valid_files'))
          return
        }

        // 排序并显示上传结果
        setFolderExpandedByPath(targetFolderPath, true)
        await refreshTree()

        if (result.failedFiles > 0) {
          window.toast.warning(
            t('notes.upload_partial_failed', { uploaded: result.fileCount, failed: result.failedFiles })
          )
          return
        }

        window.toast.success(t('notes.upload_success'))
      } catch (error) {
        logger.error('Failed to handle file upload:', error as Error)
        window.toast.error(t('notes.upload_failed'))
      }
    },
    [getTargetFolderPath, refreshTree, setFolderExpandedByPath, t]
  )

  // 处理节点移动
  const handleMoveNode = useCallback(
    async (sourceNodeId: string, targetNodeId: string, position: 'before' | 'after' | 'inside') => {
      if (!notesPath) {
        return
      }

      try {
        const sourceNode = findNode(notesTree, sourceNodeId)
        const targetNode = findNode(notesTree, targetNodeId)

        if (!sourceNode || !targetNode) {
          return
        }

        if (position === 'inside' && targetNode.type !== 'folder') {
          return
        }

        const rootPath = normalizePathValue(notesPath)
        const sourceParentNode = findParent(notesTree, sourceNodeId)
        const targetParentNode = position === 'inside' ? targetNode : findParent(notesTree, targetNodeId)

        const sourceParentPath = sourceParentNode ? sourceParentNode.externalPath : rootPath
        const targetParentPath =
          position === 'inside' ? targetNode.externalPath : targetParentNode ? targetParentNode.externalPath : rootPath

        const normalizedSourceParent = normalizePathValue(sourceParentPath)
        const normalizedTargetParent = normalizePathValue(targetParentPath)

        const isManualReorder = position !== 'inside' && normalizedSourceParent === normalizedTargetParent

        if (isManualReorder) {
          // For manual reordering within the same parent, we can optimize by only updating the affected parent
          setNotesTree((prev) =>
            reorderTreeNodes(prev, sourceNodeId, targetNodeId, position === 'before' ? 'before' : 'after')
          )
          return
        }

        const { safeName } = await window.api.file.checkFileName(
          normalizedTargetParent,
          sourceNode.name,
          sourceNode.type === 'file'
        )

        const destinationPath =
          sourceNode.type === 'file'
            ? `${normalizedTargetParent}/${safeName}.md`
            : `${normalizedTargetParent}/${safeName}`

        if (destinationPath === sourceNode.externalPath) {
          return
        }

        if (sourceNode.type === 'file') {
          await window.api.file.move(sourceNode.externalPath, destinationPath)
        } else {
          await window.api.file.moveDir(sourceNode.externalPath, destinationPath)
        }

        const metadataSynced = await syncMetadataAfterFileOperation(
          () => rewritePath(sourceNode.externalPath, destinationPath, sourceNode.type === 'folder'),
          () => rollbackFileMove(destinationPath, sourceNode.externalPath, sourceNode.type)
        )
        if (!metadataSynced) {
          return
        }
        setFolderExpandedByPath(normalizedTargetParent, true)

        const normalizedActivePath = activeFilePath ? normalizePathValue(activeFilePath) : undefined
        let nextActivePath: string | undefined
        if (normalizedActivePath) {
          if (normalizedActivePath === sourceNode.externalPath) {
            // Cancel debounced save to prevent saving to old path
            debouncedSaveRef.current?.cancel()
            nextActivePath = destinationPath
          } else if (sourceNode.type === 'folder' && normalizedActivePath.startsWith(`${sourceNode.externalPath}/`)) {
            const suffix = normalizedActivePath.slice(sourceNode.externalPath.length)
            // Cancel debounced save to prevent saving to old path
            debouncedSaveRef.current?.cancel()
            nextActivePath = `${destinationPath}${suffix}`
          }
        }

        if (nextActivePath) {
          lastFilePathRef.current = nextActivePath
          setActiveFilePath(nextActivePath)
        }

        await refreshTree()
      } catch (error) {
        logger.error('Failed to move nodes:', error as Error)
        window.toast.error(t('notes.move_failed'))
      }
    },
    [
      activeFilePath,
      notesPath,
      notesTree,
      refreshTree,
      rewritePath,
      rollbackFileMove,
      setActiveFilePath,
      setFolderExpandedByPath,
      syncMetadataAfterFileOperation,
      t
    ]
  )

  // 处理节点排序
  const handleSortNodes = useCallback(
    async (newSortType: NotesSortType) => {
      updateSortType(newSortType)
      setNotesTree((prev) => mergeTreeState(sortTree(prev, newSortType)))
    },
    [mergeTreeState, updateSortType]
  )

  const handleExpandPath = useCallback(
    (treePath: string) => {
      if (!treePath) {
        return
      }

      const segments = treePath.split('/').filter(Boolean)
      if (segments.length === 0) {
        return
      }

      let nextTree = notesTree
      const pathsToAdd: string[] = []

      segments.forEach((_, index) => {
        const currentPath = '/' + segments.slice(0, index + 1).join('/')
        const node = findNodeByPath(nextTree, currentPath)
        if (node && node.type === 'folder' && !node.expanded) {
          pathsToAdd.push(node.externalPath)
          nextTree = updateTreeNode(nextTree, node.id, (current) => ({ ...current, expanded: true }))
        }
      })

      if (pathsToAdd.length > 0) {
        setNotesTree(nextTree)
        pathsToAdd.forEach((path) => {
          const node = findNodeByPath(notesTree, path)
          if (node?.type === 'folder') {
            persistMetadataPatch(node, { isExpanded: true })
          }
        })
      }
    },
    [notesTree, persistMetadataPatch]
  )

  const getCurrentNoteContent = useCallback(() => {
    if (settings.defaultEditMode === 'source') {
      return currentContent
    } else {
      return editorRef.current?.getMarkdown() || currentContent
    }
  }, [currentContent, settings.defaultEditMode])

  // Listen for external requests to locate a specific line in a note
  useEffect(() => {
    const handleLocateNoteLine = ({
      noteId,
      lineNumber,
      lineContent
    }: {
      noteId: string
      lineNumber: number
      lineContent?: string
    }) => {
      const targetNode = findNode(notesTree, noteId)

      if (!targetNode || targetNode.type !== 'file') {
        logger.warn('Target note not found or not a file', { noteId })
        return
      }

      const needsSwitchFile = targetNode.externalPath !== activeFilePath

      if (needsSwitchFile) {
        // switch to target note first then scroll to line
        pendingScrollRef.current = { lineNumber, lineContent }
        setActiveFilePath(targetNode.externalPath)
        invalidateFileContent(targetNode.externalPath)
      } else {
        const richEditor = editorRef.current
        const codeEditor = codeEditorRef.current

        try {
          if (codeEditor?.scrollToLine) {
            codeEditor.scrollToLine(lineNumber, { highlight: true })
          } else if (richEditor?.scrollToLine) {
            richEditor.scrollToLine(lineNumber, { highlight: true, lineContent })
          }
        } catch (error) {
          logger.error('Failed to scroll to line:', error as Error)
        }
      }
    }

    const unsubscribe = EventEmitter.on(EVENT_NAMES.LOCATE_NOTE_LINE, handleLocateNoteLine)
    return () => {
      unsubscribe()
    }
  }, [activeNode?.id, activeFilePath, notesTree, invalidateFileContent, setActiveFilePath])

  return (
    <div id="notes-page" className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div id="content-container" className="flex h-full min-h-0 flex-1 flex-row overflow-hidden">
        <AnimatePresence initial={false}>
          {showWorkspace && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 250, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              style={{ height: '100%', overflow: 'hidden', flexShrink: 0 }}>
              <NotesSidebar
                notesTree={notesTree}
                activeFilePath={activeFilePath}
                sortType={sortType}
                selectedFolderId={selectedFolderId}
                onSelectNode={handleSelectNode}
                onCreateFolder={handleCreateFolder}
                onCreateNote={handleCreateNote}
                onDeleteNode={handleDeleteNode}
                onRenameNode={handleRenameNode}
                onToggleExpanded={handleToggleExpanded}
                onToggleStar={handleToggleStar}
                onMoveNode={handleMoveNode}
                onSortNodes={handleSortNodes}
                onUploadFiles={handleUploadFiles}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="relative flex min-h-0 min-w-0 max-w-full flex-1 flex-col justify-between overflow-hidden">
          <HeaderNavbar
            notesTree={notesTree}
            activeFilePath={activeFilePath}
            getCurrentNoteContent={getCurrentNoteContent}
            onToggleStar={handleToggleStar}
            onExpandPath={handleExpandPath}
            onRenameNode={handleRenameNode}
          />
          <NotesEditor
            activeNodeId={activeNode?.id}
            currentContent={currentContent}
            contentLoadError={contentLoadError as Error | undefined}
            tokenCount={tokenCount}
            onMarkdownChange={handleMarkdownChange}
            editorRef={editorRef}
            codeEditorRef={codeEditorRef}
          />
        </div>
      </div>
    </div>
  )
}

export default NotesPage
