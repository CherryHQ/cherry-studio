import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { RichEditorRef } from '@renderer/components/RichEditor/types'
import { useActiveNode, useFileContent, useFileContentSync } from '@renderer/hooks/useNotesQuery'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useSettings } from '@renderer/hooks/useSettings'
import {
  createFolder,
  createNote,
  deleteNode,
  initWorkSpace,
  moveNode,
  renameNode,
  sortAllLevels,
  uploadNote
} from '@renderer/services/NotesService'
import { getNotesTree, isParentNode, updateNodeInTree } from '@renderer/services/NotesTreeService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { selectActiveFilePath, setActiveFilePath } from '@renderer/store/note'
import { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import { FileChangeEvent } from '@shared/config/types'
import { useLiveQuery } from 'dexie-react-hooks'
import { debounce } from 'lodash'
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
  const { showWorkspace } = useSettings()
  const dispatch = useAppDispatch()
  const activeFilePath = useAppSelector(selectActiveFilePath)
  const { settings, notesPath, updateNotesPath } = useNotesSettings()

  // 混合策略：useLiveQuery用于笔记树，React Query用于文件内容
  const notesTreeQuery = useLiveQuery(() => getNotesTree(), [])
  const notesTree = useMemo(() => notesTreeQuery || [], [notesTreeQuery])
  const { activeNode } = useActiveNode(notesTree)
  const { invalidateFileContent } = useFileContentSync()
  const { data: currentContent = '', isLoading: isContentLoading } = useFileContent(activeFilePath)

  const [tokenCount, setTokenCount] = useState(0)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const watcherRef = useRef<(() => void) | null>(null)
  const isSyncingTreeRef = useRef(false)
  const isEditorInitialized = useRef(false)
  const lastContentRef = useRef<string>('')
  const isInitialSortApplied = useRef(false)

  useEffect(() => {
    const updateCharCount = () => {
      const textContent = editorRef.current?.getContent() || currentContent
      const plainText = textContent.replace(/<[^>]*>/g, '')
      setTokenCount(plainText.length)
    }
    updateCharCount()
  }, [currentContent])

  // 查找树节点 by ID
  const findNodeById = useCallback((tree: NotesTreeNode[], nodeId: string): NotesTreeNode | null => {
    for (const node of tree) {
      if (node.id === nodeId) {
        return node
      }
      if (node.children) {
        const found = findNodeById(node.children, nodeId)
        if (found) return found
      }
    }
    return null
  }, [])

  // 保存当前笔记内容
  const saveCurrentNote = useCallback(
    async (content: string) => {
      if (!activeFilePath || content === currentContent) return

      try {
        await window.api.file.write(activeFilePath, content)
      } catch (error) {
        logger.error('Failed to save note:', error as Error)
      }
    },
    [activeFilePath, currentContent]
  )

  // 防抖保存函数，在停止输入后才保存，避免输入过程中的文件写入
  const debouncedSave = useMemo(
    () =>
      debounce((content: string) => {
        saveCurrentNote(content)
      }, 800), // 800ms防抖延迟
    [saveCurrentNote]
  )

  const handleMarkdownChange = useCallback(
    (newMarkdown: string) => {
      // 记录最新内容，用于兜底保存
      lastContentRef.current = newMarkdown
      debouncedSave(newMarkdown)
    },
    [debouncedSave]
  )

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

  // 应用初始排序
  useEffect(() => {
    async function applyInitialSort() {
      if (notesTree.length > 0 && !isInitialSortApplied.current) {
        try {
          await sortAllLevels('sort_a2z')
          isInitialSortApplied.current = true
        } catch (error) {
          logger.error('Failed to apply initial sorting:', error as Error)
        }
      }
    }

    applyInitialSort()
  }, [notesTree.length])

  // 处理树同步时的状态管理
  useEffect(() => {
    if (notesTree.length === 0) return

    // 如果有activeFilePath但找不到对应节点，清空选择
    if (activeFilePath && !activeNode) {
      dispatch(setActiveFilePath(undefined))
    }
  }, [notesTree, activeFilePath, activeNode, dispatch])

  useEffect(() => {
    if (!notesPath || notesTree.length === 0) return

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

          switch (eventType) {
            case 'change': {
              // 处理文件内容变化 - 只有内容真正改变时才触发更新
              if (activeFilePath === filePath) {
                try {
                  // 读取文件最新内容
                  // const newFileContent = await window.api.file.readExternal(filePath)
                  // // 获取当前编辑器/缓存中的内容
                  // const currentEditorContent = editorRef.current?.getMarkdown()
                  // // 如果编辑器还未初始化完成，忽略FileWatcher事件
                  // if (!isEditorInitialized.current) {
                  //   return
                  // }
                  // // 比较内容是否真正发生变化
                  // if (newFileContent.trim() !== currentEditorContent?.trim()) {
                  //   invalidateFileContent(filePath)
                  // }
                } catch (error) {
                  logger.error('Failed to read file for content comparison:', error as Error)
                  // 读取失败时，还是执行原来的逻辑
                  invalidateFileContent(filePath)
                }
              } else {
                await initWorkSpace(notesPath)
              }
              break
            }

            case 'add':
            case 'addDir':
            case 'unlink':
            case 'unlinkDir': {
              // 如果删除的是当前活动文件，清空选择
              if ((eventType === 'unlink' || eventType === 'unlinkDir') && activeFilePath === filePath) {
                dispatch(setActiveFilePath(undefined))
              }

              // 设置同步标志，避免竞态条件
              isSyncingTreeRef.current = true

              // 重新同步数据库，useLiveQuery会自动响应数据库变化
              try {
                await initWorkSpace(notesPath)
              } catch (error) {
                logger.error('Failed to sync database:', error as Error)
              } finally {
                isSyncingTreeRef.current = false
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
      if (lastContentRef.current && lastContentRef.current !== currentContent) {
        saveCurrentNote(lastContentRef.current).catch((error) => {
          logger.error('Emergency save failed:', error as Error)
        })
      }

      // 清理防抖函数
      debouncedSave.cancel()
    }
  }, [
    notesPath,
    notesTree.length,
    activeFilePath,
    invalidateFileContent,
    dispatch,
    currentContent,
    debouncedSave,
    saveCurrentNote
  ])

  useEffect(() => {
    if (currentContent && editorRef.current) {
      editorRef.current.setMarkdown(currentContent)
      // 标记编辑器已初始化
      isEditorInitialized.current = true
    }
  }, [currentContent])

  // 切换文件时重置编辑器初始化状态并兜底保存
  useEffect(() => {
    if (lastContentRef.current && lastContentRef.current !== currentContent) {
      saveCurrentNote(lastContentRef.current).catch((error) => {
        logger.error('Emergency save before file switch failed:', error as Error)
      })
    }

    // 重置状态
    isEditorInitialized.current = false
    lastContentRef.current = ''
  }, [activeFilePath, currentContent, saveCurrentNote])

  // 获取目标文件夹路径（选中文件夹或根目录）
  const getTargetFolderPath = useCallback(() => {
    if (selectedFolderId) {
      const selectedNode = findNodeById(notesTree, selectedFolderId)
      if (selectedNode && selectedNode.type === 'folder') {
        return selectedNode.externalPath
      }
    }
    return notesPath // 默认返回根目录
  }, [selectedFolderId, notesTree, notesPath, findNodeById])

  // 创建文件夹
  const handleCreateFolder = useCallback(
    async (name: string) => {
      try {
        const targetPath = getTargetFolderPath()
        if (!targetPath) {
          throw new Error('No folder path selected')
        }
        await createFolder(name, targetPath)
      } catch (error) {
        logger.error('Failed to create folder:', error as Error)
      }
    },
    [getTargetFolderPath]
  )

  // 创建笔记
  const handleCreateNote = useCallback(
    async (name: string) => {
      try {
        const targetPath = getTargetFolderPath()
        if (!targetPath) {
          throw new Error('No folder path selected')
        }
        const newNote = await createNote(name, '', targetPath)
        dispatch(setActiveFilePath(newNote.externalPath))
      } catch (error) {
        logger.error('Failed to create note:', error as Error)
      }
    },
    [dispatch, getTargetFolderPath]
  )

  // 切换展开状态
  const toggleNodeExpanded = useCallback(
    async (nodeId: string) => {
      try {
        const tree = await getNotesTree()
        const node = findNodeById(tree, nodeId)

        if (node && node.type === 'folder') {
          await updateNodeInTree(tree, nodeId, {
            expanded: !node.expanded
          })
        }

        return tree
      } catch (error) {
        logger.error('Failed to toggle expanded:', error as Error)
        throw error
      }
    },
    [findNodeById]
  )

  const handleToggleExpanded = useCallback(
    async (nodeId: string) => {
      try {
        await toggleNodeExpanded(nodeId)
      } catch (error) {
        logger.error('Failed to toggle expanded:', error as Error)
      }
    },
    [toggleNodeExpanded]
  )

  // 切换收藏状态
  const toggleStarred = useCallback(
    async (nodeId: string) => {
      try {
        const tree = await getNotesTree()
        const node = findNodeById(tree, nodeId)

        if (node && node.type === 'file') {
          await updateNodeInTree(tree, nodeId, {
            isStarred: !node.isStarred
          })
        }

        return tree
      } catch (error) {
        logger.error('Failed to toggle star:', error as Error)
        throw error
      }
    },
    [findNodeById]
  )

  const handleToggleStar = useCallback(
    async (nodeId: string) => {
      try {
        await toggleStarred(nodeId)
      } catch (error) {
        logger.error('Failed to toggle star:', error as Error)
      }
    },
    [toggleStarred]
  )

  // 选择节点
  const handleSelectNode = useCallback(
    async (node: NotesTreeNode) => {
      if (node.type === 'file') {
        try {
          dispatch(setActiveFilePath(node.externalPath))
          // 清除文件夹选择状态
          setSelectedFolderId(null)
        } catch (error) {
          logger.error('Failed to load note:', error as Error)
        }
      } else if (node.type === 'folder') {
        // 设置选中的文件夹，同时清除活动文件
        setSelectedFolderId(node.id)
        // 清除活动文件状态，这样文件的高亮会被清除
        dispatch(setActiveFilePath(undefined))
        await handleToggleExpanded(node.id)
      }
    },
    [dispatch, handleToggleExpanded]
  )

  // 删除节点
  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      try {
        const nodeToDelete = findNodeById(notesTree, nodeId)
        if (!nodeToDelete) return

        const isActiveNodeOrParent =
          activeFilePath &&
          (nodeToDelete.externalPath === activeFilePath || isParentNode(notesTree, nodeId, activeNode?.id || ''))

        await deleteNode(nodeId)

        // 如果删除的是当前活动节点或其父节点，清空编辑器
        if (isActiveNodeOrParent) {
          dispatch(setActiveFilePath(undefined))
          if (editorRef.current) {
            editorRef.current.clear()
          }
        }
      } catch (error) {
        logger.error('Failed to delete node:', error as Error)
      }
    },
    [activeFilePath, activeNode, notesTree, dispatch, findNodeById]
  )

  // 重命名节点
  const handleRenameNode = useCallback(
    async (nodeId: string, newName: string) => {
      try {
        const tree = await getNotesTree()
        const node = findNodeById(tree, nodeId)

        if (node && node.name !== newName) {
          await renameNode(nodeId, newName)
        }
      } catch (error) {
        logger.error('Failed to rename node:', error as Error)
      }
    },
    [findNodeById]
  )

  // 处理文件上传
  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      try {
        const fileToUpload = files[0]

        if (!fileToUpload) {
          window.message.warning(t('notes.no_file_selected'))
          return
        }
        // 暂时这么处理
        if (files.length > 1) {
          window.message.warning(t('notes.only_one_file_allowed'))
        }

        if (!fileToUpload.name.toLowerCase().endsWith('.md')) {
          window.message.warning(t('notes.only_markdown'))
          return
        }

        try {
          if (!notesPath) {
            throw new Error('No folder path selected')
          }
          await uploadNote(fileToUpload, notesPath)
          window.message.success(t('notes.upload_success', { count: 1 }))
        } catch (error) {
          logger.error(`Failed to upload note file ${fileToUpload.name}:`, error as Error)
          window.message.error(t('notes.upload_failed', { name: fileToUpload.name }))
        }
      } catch (error) {
        logger.error('Failed to handle file upload:', error as Error)
        window.message.error(t('notes.upload_failed'))
      }
    },
    [notesPath, t]
  )

  // 处理节点移动
  const handleMoveNode = useCallback(
    async (sourceNodeId: string, targetNodeId: string, position: 'before' | 'after' | 'inside') => {
      try {
        await moveNode(sourceNodeId, targetNodeId, position)
      } catch (error) {
        logger.error('Failed to move nodes:', error as Error)
      }
    },
    []
  )

  // 处理节点排序
  const handleSortNodes = useCallback(async (sortType: NotesSortType) => {
    try {
      await sortAllLevels(sortType)
    } catch (error) {
      logger.error('Failed to sort notes:', error as Error)
      throw error
    }
  }, [])

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
        {showWorkspace && (
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
        )}
        <EditorWrapper>
          <HeaderNavbar notesTree={notesTree} getCurrentNoteContent={getCurrentNoteContent} />
          <NotesEditor
            activeNodeId={activeNode?.id}
            currentContent={currentContent}
            tokenCount={tokenCount}
            isLoading={isContentLoading}
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
