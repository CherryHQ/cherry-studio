import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { RichEditorRef } from '@renderer/components/RichEditor/types'
import { useActiveNode, useFileContent, useFileContentSync } from '@renderer/hooks/useNotesQuery'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useShowWorkspace } from '@renderer/hooks/useShowWorkspace'
import {
  addDir,
  addNote,
  delNode,
  loadTree,
  renameNode as renameEntry,
  sortTree,
  uploadNotes
} from '@renderer/services/NotesService'
import {
  addUniquePath,
  findNode,
  findNodeByPath,
  findParent,
  normalizePathValue,
  removePathEntries,
  reorderTreeNodes,
  replacePathEntries,
  updateTreeNode
} from '@renderer/services/NotesTreeService'
import { useAppDispatch, useAppSelector, useAppStore } from '@renderer/store'
import {
  selectActiveFilePath,
  selectExpandedPaths,
  selectSortType,
  selectStarredPaths,
  setActiveFilePath,
  setExpandedPaths,
  setSortType,
  setStarredPaths
} from '@renderer/store/note'
import { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import { FileChangeEvent } from '@shared/config/types'
import { debounce } from 'lodash'
import { AnimatePresence, motion } from 'motion/react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import HeaderNavbar from './HeaderNavbar'
import NotesEditor from './NotesEditor'
import NotesSidebar from './NotesSidebar'

const logger = loggerService.withContext('NotesPage')

const NotesPage: FC = () => {
  const editorRef = useRef<RichEditorRef>(null)
  const { t } = useTranslation()
  const { showWorkspace } = useShowWorkspace()
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const activeFilePath = useAppSelector(selectActiveFilePath)
  const sortType = useAppSelector(selectSortType)
  const starredPaths = useAppSelector(selectStarredPaths)
  const expandedPaths = useAppSelector(selectExpandedPaths)
  const { settings, notesPath, updateNotesPath } = useNotesSettings()

  // 混合策略：useLiveQuery用于笔记树，React Query用于文件内容
  const [notesTree, setNotesTree] = useState<NotesTreeNode[]>([])
  const starredSet = useMemo(() => new Set(starredPaths), [starredPaths])
  const expandedSet = useMemo(() => new Set(expandedPaths), [expandedPaths])
  const { activeNode } = useActiveNode(notesTree)
  const { invalidateFileContent } = useFileContentSync()
  const { data: currentContent = '' } = useFileContent(activeFilePath)

  const [tokenCount, setTokenCount] = useState(0)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const watcherRef = useRef<(() => void) | null>(null)
  const lastContentRef = useRef<string>('')
  const lastFilePathRef = useRef<string | undefined>(undefined)
  const isRenamingRef = useRef(false)
  const isCreatingNoteRef = useRef(false)

  const activeFilePathRef = useRef<string | undefined>(activeFilePath)
  const currentContentRef = useRef(currentContent)

  const updateStarredPaths = useCallback(
    (updater: (paths: string[]) => string[]) => {
      const current = store.getState().note.starredPaths
      const safeCurrent = Array.isArray(current) ? current : []
      const next = updater(safeCurrent) ?? []
      if (!Array.isArray(next)) {
        return
      }
      if (next !== safeCurrent) {
        dispatch(setStarredPaths(next))
      }
    },
    [dispatch, store]
  )

  const updateExpandedPaths = useCallback(
    (updater: (paths: string[]) => string[]) => {
      const current = store.getState().note.expandedPaths
      const safeCurrent = Array.isArray(current) ? current : []
      const next = updater(safeCurrent) ?? []
      if (!Array.isArray(next)) {
        return
      }
      if (next !== safeCurrent) {
        dispatch(setExpandedPaths(next))
      }
    },
    [dispatch, store]
  )

  const mergeTreeState = useCallback(
    (nodes: NotesTreeNode[]): NotesTreeNode[] => {
      return nodes.map((node) => {
        const normalizedPath = normalizePathValue(node.externalPath)
        const merged: NotesTreeNode = {
          ...node,
          externalPath: normalizedPath,
          isStarred: starredSet.has(normalizedPath)
        }

        if (node.type === 'folder') {
          merged.expanded = expandedSet.has(normalizedPath)
          merged.children = node.children ? mergeTreeState(node.children) : []
        }

        return merged
      })
    },
    [starredSet, expandedSet]
  )

  const refreshTree = useCallback(async () => {
    if (!notesPath) {
      setNotesTree([])
      return
    }

    try {
      const rawTree = await loadTree(notesPath)
      const sortedTree = sortTree(rawTree, sortType)
      setNotesTree(mergeTreeState(sortedTree))
    } catch (error) {
      logger.error('Failed to refresh notes tree:', error as Error)
    }
  }, [mergeTreeState, notesPath, sortType])

  useEffect(() => {
    const updateCharCount = () => {
      const textContent = editorRef.current?.getContent() || currentContent
      const plainText = textContent.replace(/<[^>]*>/g, '')
      setTokenCount(plainText.length)
    }
    updateCharCount()
  }, [currentContent])

  useEffect(() => {
    refreshTree()
  }, [refreshTree])

  // Re-merge tree state when starred or expanded paths change
  useEffect(() => {
    if (notesTree.length > 0) {
      setNotesTree((prev) => mergeTreeState(prev))
    }
  }, [starredPaths, expandedPaths, mergeTreeState, notesTree.length])

  // 保存当前笔记内容
  const saveCurrentNote = useCallback(
    async (content: string, filePath?: string) => {
      const targetPath = filePath || activeFilePath
      if (!targetPath || content.trim() === currentContent.trim()) return

      try {
        await window.api.file.write(targetPath, content)
        // 保存后立即刷新缓存，确保下次读取时获取最新内容
        invalidateFileContent(targetPath)
      } catch (error) {
        logger.error('Failed to save note:', error as Error)
      }
    },
    [activeFilePath, currentContent, invalidateFileContent]
  )

  // 防抖保存函数，在停止输入后才保存，避免输入过程中的文件写入
  const debouncedSave = useMemo(
    () =>
      debounce((content: string, filePath: string | undefined) => {
        saveCurrentNote(content, filePath)
      }, 800), // 800ms防抖延迟
    [saveCurrentNote]
  )

  const saveCurrentNoteRef = useRef(saveCurrentNote)
  const debouncedSaveRef = useRef(debouncedSave)
  const invalidateFileContentRef = useRef(invalidateFileContent)
  const refreshTreeRef = useRef(refreshTree)

  const handleMarkdownChange = useCallback(
    (newMarkdown: string) => {
      // 记录最新内容和文件路径，用于兜底保存
      lastContentRef.current = newMarkdown
      lastFilePathRef.current = activeFilePath
      // 捕获当前文件路径，避免在防抖执行时文件路径已改变的竞态条件
      debouncedSave(newMarkdown, activeFilePath)
    },
    [debouncedSave, activeFilePath]
  )

  useEffect(() => {
    activeFilePathRef.current = activeFilePath
  }, [activeFilePath])

  useEffect(() => {
    currentContentRef.current = currentContent
  }, [currentContent])

  useEffect(() => {
    saveCurrentNoteRef.current = saveCurrentNote
  }, [saveCurrentNote])

  useEffect(() => {
    debouncedSaveRef.current = debouncedSave
  }, [debouncedSave])

  useEffect(() => {
    invalidateFileContentRef.current = invalidateFileContent
  }, [invalidateFileContent])

  useEffect(() => {
    refreshTreeRef.current = refreshTree
  }, [refreshTree])

  useEffect(() => {
    async function initialize() {
      if (!notesPath) {
        // 首次启动，获取默认路径
        const info = await window.api.getAppInfo()
        const defaultPath = info.notesPath
        updateNotesPath(defaultPath)
        return
      }
    }

    initialize()
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
      dispatch(setActiveFilePath(undefined))
    }
  }, [notesTree, activeFilePath, activeNode, dispatch])

  useEffect(() => {
    if (!notesPath) return

    async function startFileWatcher() {
      // 清理之前的监控
      if (watcherRef.current) {
        watcherRef.current()
        watcherRef.current = null
      }

      // 定义文件变化处理函数
      const handleFileChange = async (data: FileChangeEvent) => {
        try {
          if (!notesPath) return
          const { eventType, filePath } = data
          const normalizedEventPath = normalizePathValue(filePath)

          switch (eventType) {
            case 'change': {
              // 处理文件内容变化 - 只有内容真正改变时才触发更新
              const activePath = activeFilePathRef.current
              if (activePath && normalizePathValue(activePath) === normalizedEventPath) {
                invalidateFileContentRef.current?.(normalizedEventPath)
              }
              break
            }

            case 'add':
            case 'addDir':
            case 'unlink':
            case 'unlinkDir': {
              // 如果删除的是当前活动文件，清空选择
              if (
                (eventType === 'unlink' || eventType === 'unlinkDir') &&
                activeFilePathRef.current &&
                normalizePathValue(activeFilePathRef.current) === normalizedEventPath
              ) {
                dispatch(setActiveFilePath(undefined))
                editorRef.current?.clear()
              }

              const refresh = refreshTreeRef.current
              if (refresh) {
                await refresh()
              }
              break
            }

            default:
              logger.debug('Unhandled file event type:', { eventType })
          }
        } catch (error) {
          logger.error('Failed to handle file change:', error as Error)
        }
      }

      try {
        await window.api.file.startFileWatcher(notesPath)
        watcherRef.current = window.api.file.onFileChange(handleFileChange)
      } catch (error) {
        logger.error('Failed to start file watcher:', error as Error)
      }
    }

    startFileWatcher()

    return () => {
      if (watcherRef.current) {
        watcherRef.current()
        watcherRef.current = null
      }
      window.api.file.stopFileWatcher().catch((error) => {
        logger.error('Failed to stop file watcher:', error)
      })

      // 如果有未保存的内容，立即保存
      if (lastContentRef.current && lastFilePathRef.current && lastContentRef.current !== currentContentRef.current) {
        const saveFn = saveCurrentNoteRef.current
        if (saveFn) {
          saveFn(lastContentRef.current, lastFilePathRef.current).catch((error) => {
            logger.error('Emergency save failed:', error as Error)
          })
        }
      }

      // 清理防抖函数
      debouncedSaveRef.current?.cancel()
    }
  }, [dispatch, notesPath])

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
      debouncedSave.cancel()
      lastContentRef.current = ''
      lastFilePathRef.current = undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath])

  // 获取目标文件夹路径（选中文件夹或根目录）
  const getTargetFolderPath = useCallback(() => {
    if (selectedFolderId) {
      const selectedNode = findNode(notesTree, selectedFolderId)
      if (selectedNode && selectedNode.type === 'folder') {
        return selectedNode.externalPath
      }
    }
    return notesPath // 默认返回根目录
  }, [selectedFolderId, notesTree, notesPath])

  // 创建文件夹
  const handleCreateFolder = useCallback(
    async (name: string) => {
      try {
        const targetPath = getTargetFolderPath()
        if (!targetPath) {
          throw new Error('No folder path selected')
        }
        await addDir(name, targetPath)
        updateExpandedPaths((prev) => addUniquePath(prev, normalizePathValue(targetPath)))
        await refreshTree()
      } catch (error) {
        logger.error('Failed to create folder:', error as Error)
      }
    },
    [getTargetFolderPath, refreshTree, updateExpandedPaths]
  )

  // 创建笔记
  const handleCreateNote = useCallback(
    async (name: string) => {
      try {
        isCreatingNoteRef.current = true

        const targetPath = getTargetFolderPath()
        if (!targetPath) {
          throw new Error('No folder path selected')
        }
        const { path: notePath } = await addNote(name, '', targetPath)
        const normalizedParent = normalizePathValue(targetPath)
        updateExpandedPaths((prev) => addUniquePath(prev, normalizedParent))
        dispatch(setActiveFilePath(notePath))
        setSelectedFolderId(null)

        await refreshTree()
      } catch (error) {
        logger.error('Failed to create note:', error as Error)
      } finally {
        // 延迟重置标志，给数据库同步一些时间
        setTimeout(() => {
          isCreatingNoteRef.current = false
        }, 500)
      }
    },
    [dispatch, getTargetFolderPath, refreshTree, updateExpandedPaths]
  )

  const handleToggleExpanded = useCallback(
    (nodeId: string) => {
      const targetNode = findNode(notesTree, nodeId)
      if (!targetNode || targetNode.type !== 'folder') {
        return
      }

      const nextExpanded = !targetNode.expanded
      // Update Redux state first, then let mergeTreeState handle the UI update
      updateExpandedPaths((prev) =>
        nextExpanded
          ? addUniquePath(prev, targetNode.externalPath)
          : removePathEntries(prev, targetNode.externalPath, false)
      )
    },
    [notesTree, updateExpandedPaths]
  )

  const handleToggleStar = useCallback(
    (nodeId: string) => {
      const node = findNode(notesTree, nodeId)
      if (!node) {
        return
      }

      const nextStarred = !node.isStarred
      // Update Redux state first, then let mergeTreeState handle the UI update
      updateStarredPaths((prev) =>
        nextStarred ? addUniquePath(prev, node.externalPath) : removePathEntries(prev, node.externalPath, false)
      )
    },
    [notesTree, updateStarredPaths]
  )

  // 选择节点
  const handleSelectNode = useCallback(
    async (node: NotesTreeNode) => {
      if (node.type === 'file') {
        try {
          dispatch(setActiveFilePath(node.externalPath))
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
    [dispatch, handleToggleExpanded, invalidateFileContent]
  )

  // 删除节点
  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      try {
        const nodeToDelete = findNode(notesTree, nodeId)
        if (!nodeToDelete) return

        await delNode(nodeToDelete)

        updateStarredPaths((prev) => removePathEntries(prev, nodeToDelete.externalPath, nodeToDelete.type === 'folder'))
        updateExpandedPaths((prev) =>
          removePathEntries(prev, nodeToDelete.externalPath, nodeToDelete.type === 'folder')
        )

        const normalizedActivePath = activeFilePath ? normalizePathValue(activeFilePath) : undefined
        const normalizedDeletePath = normalizePathValue(nodeToDelete.externalPath)
        const isActiveNode = normalizedActivePath === normalizedDeletePath
        const isActiveDescendant =
          nodeToDelete.type === 'folder' &&
          normalizedActivePath &&
          normalizedActivePath.startsWith(`${normalizedDeletePath}/`)

        if (isActiveNode || isActiveDescendant) {
          dispatch(setActiveFilePath(undefined))
          editorRef.current?.clear()
        }

        await refreshTree()
      } catch (error) {
        logger.error('Failed to delete node:', error as Error)
      }
    },
    [notesTree, activeFilePath, dispatch, refreshTree, updateStarredPaths, updateExpandedPaths]
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

        if (node.type === 'file' && activeFilePath === oldPath) {
          debouncedSaveRef.current?.cancel()
          lastFilePathRef.current = renamed.path
          dispatch(setActiveFilePath(renamed.path))
        } else if (node.type === 'folder' && activeFilePath && activeFilePath.startsWith(`${oldPath}/`)) {
          const suffix = activeFilePath.slice(oldPath.length)
          const nextActivePath = `${renamed.path}${suffix}`
          debouncedSaveRef.current?.cancel()
          lastFilePathRef.current = nextActivePath
          dispatch(setActiveFilePath(nextActivePath))
        }

        updateStarredPaths((prev) => replacePathEntries(prev, oldPath, renamed.path, node.type === 'folder'))
        updateExpandedPaths((prev) => replacePathEntries(prev, oldPath, renamed.path, node.type === 'folder'))

        await refreshTree()
      } catch (error) {
        logger.error('Failed to rename node:', error as Error)
      } finally {
        setTimeout(() => {
          isRenamingRef.current = false
        }, 500)
      }
    },
    [activeFilePath, dispatch, notesTree, refreshTree, updateStarredPaths, updateExpandedPaths]
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

        const result = await uploadNotes(files, targetFolderPath)

        // 检查上传结果
        if (result.fileCount === 0) {
          window.toast.warning(t('notes.no_valid_files'))
          return
        }

        // 排序并显示成功信息
        updateExpandedPaths((prev) => addUniquePath(prev, normalizePathValue(targetFolderPath)))
        await refreshTree()

        const successMessage = t('notes.upload_success')

        window.toast.success(successMessage)
      } catch (error) {
        logger.error('Failed to handle file upload:', error as Error)
        window.toast.error(t('notes.upload_failed'))
      }
    },
    [getTargetFolderPath, refreshTree, t, updateExpandedPaths]
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

        updateStarredPaths((prev) =>
          replacePathEntries(prev, sourceNode.externalPath, destinationPath, sourceNode.type === 'folder')
        )
        updateExpandedPaths((prev) => {
          let next = replacePathEntries(prev, sourceNode.externalPath, destinationPath, sourceNode.type === 'folder')
          next = addUniquePath(next, normalizedTargetParent)
          return next
        })

        const normalizedActivePath = activeFilePath ? normalizePathValue(activeFilePath) : undefined
        if (normalizedActivePath) {
          if (normalizedActivePath === sourceNode.externalPath) {
            dispatch(setActiveFilePath(destinationPath))
          } else if (sourceNode.type === 'folder' && normalizedActivePath.startsWith(`${sourceNode.externalPath}/`)) {
            const suffix = normalizedActivePath.slice(sourceNode.externalPath.length)
            dispatch(setActiveFilePath(`${destinationPath}${suffix}`))
          }
        }

        await refreshTree()
      } catch (error) {
        logger.error('Failed to move nodes:', error as Error)
      }
    },
    [activeFilePath, dispatch, notesPath, notesTree, refreshTree, updateStarredPaths, updateExpandedPaths]
  )

  // 处理节点排序
  const handleSortNodes = useCallback(
    async (newSortType: NotesSortType) => {
      dispatch(setSortType(newSortType))
      setNotesTree((prev) => mergeTreeState(sortTree(prev, newSortType)))
    },
    [dispatch, mergeTreeState]
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
        updateExpandedPaths((prev) => {
          let updated = prev
          pathsToAdd.forEach((path) => {
            updated = addUniquePath(updated, path)
          })
          return updated
        })
      }
    },
    [notesTree, updateExpandedPaths]
  )

  const getCurrentNoteContent = useCallback(() => {
    if (settings.defaultEditMode === 'source') {
      return currentContent
    } else {
      return editorRef.current?.getMarkdown() || currentContent
    }
  }, [currentContent, settings.defaultEditMode])

  return (
    <Container id="notes-page">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('notes.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <AnimatePresence initial={false}>
          {showWorkspace && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 250, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}>
              <NotesSidebar
                notesTree={notesTree}
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
        <EditorWrapper>
          <HeaderNavbar
            notesTree={notesTree}
            getCurrentNoteContent={getCurrentNoteContent}
            onToggleStar={handleToggleStar}
            onExpandPath={handleExpandPath}
            onRenameNode={handleRenameNode}
          />
          <NotesEditor
            activeNodeId={activeNode?.id}
            currentContent={currentContent}
            tokenCount={tokenCount}
            onMarkdownChange={handleMarkdownChange}
            editorRef={editorRef}
          />
        </EditorWrapper>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  min-height: 0;
`

const EditorWrapper = styled.div`
  display: flex;
  position: relative;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  flex: 1;
  max-width: 100%;
  overflow: hidden;
  min-height: 0;
  min-width: 0;
`

export default NotesPage
