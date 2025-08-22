import { loggerService } from '@logger'
import { RichEditorRef } from '@renderer/components/RichEditor/types'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useSettings } from '@renderer/hooks/useSettings'
import {
  createFolder,
  createNote,
  deleteNode,
  moveNode,
  renameNode,
  sortAllLevels,
  uploadNote
} from '@renderer/services/NotesService'
import { getNotesTree, isParentNode, updateNodeInTree } from '@renderer/services/NotesTreeService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { selectActiveNodeId, setActiveNodeId } from '@renderer/store/note'
import { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import { useLiveQuery } from 'dexie-react-hooks'
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
  const activeNodeId = useAppSelector(selectActiveNodeId)
  const { settings, notesPath, updateNotesPath } = useNotesSettings()
  const [currentContent, setCurrentContent] = useState<string>('')

  const notesTreeQuery = useLiveQuery(() => getNotesTree(), [])
  const notesTree = useMemo(() => notesTreeQuery || [], [notesTreeQuery])
  const [tokenCount, setTokenCount] = useState(0)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const watcherRef = useRef<(() => void) | null>(null) // 保存清理函数
  const activeNodeIdRef = useRef(activeNodeId)
  const currentContentRef = useRef(currentContent)
  const notesTreeRef = useRef(notesTree)

  // 同步 refs 的值
  useEffect(() => {
    activeNodeIdRef.current = activeNodeId
  }, [activeNodeId])

  useEffect(() => {
    currentContentRef.current = currentContent
  }, [currentContent])

  useEffect(() => {
    notesTreeRef.current = notesTree
  }, [notesTree])

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
      if (!activeNodeId || content === currentContent) return

      try {
        const activeNode = findNodeById(notesTree, activeNodeId)
        if (activeNode && activeNode.type === 'file') {
          await window.api.file.write(activeNode.externalPath, content)
        }
      } catch (error) {
        logger.error('Failed to save note:', error as Error)
      }
    },
    [activeNodeId, currentContent, findNodeById, notesTree]
  )

  // TODO 节流
  const handleMarkdownChange = useCallback(
    (newMarkdown: string) => {
      setCurrentContent(newMarkdown)
      saveCurrentNote(newMarkdown)
    },
    [saveCurrentNote]
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

  // 监听笔记树变化，处理 activeNodeId
  useEffect(() => {
    if (notesTree.length === 0) return

    if (activeNodeId) {
      const activeNode = findNodeById(notesTree, activeNodeId)
      if (!activeNode) {
        dispatch(setActiveNodeId(undefined))
        setCurrentContent('')
      }
    }
  }, [notesTree, activeNodeId, findNodeById, dispatch])

  useEffect(() => {
    if (!notesPath || notesTree.length === 0) return

    async function startFileWatcher() {
      // 清理之前的监控
      if (watcherRef.current) {
        watcherRef.current()
        watcherRef.current = null
      }

      // 定义文件变化处理函数
      const handleFileChange = async () => {
        try {
          if (!notesPath) return

          const currentTree = notesTreeRef.current
          const currentActiveNodeId = activeNodeIdRef.current

          if (currentActiveNodeId && currentTree.length > 0) {
            const currentActiveNode = findNodeById(currentTree, currentActiveNodeId)

            if (currentActiveNode && currentActiveNode.type === 'file') {
              try {
                const content = await window.api.file.readExternal(currentActiveNode.externalPath)
                const currentEditorContent = editorRef.current?.getMarkdown() || currentContentRef.current

                if (content !== currentEditorContent) {
                  setCurrentContent(content)
                }
              } catch (error) {
                logger.error('Failed to read updated file:', error as Error)
              }
            }
          }
        } catch (error) {
          logger.error('Failed to handle file change:', error as Error)
        }
      }

      try {
        logger.info('Starting file watcher', { path: notesPath })
        await window.api.file.startFileWatcher(notesPath)
        const removeListener = window.api.file.onFileChange(handleFileChange)
        watcherRef.current = removeListener
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
    }
  }, [notesPath, notesTree.length, findNodeById, dispatch])

  useEffect(() => {
    editorRef.current?.setMarkdown(currentContent)
  }, [currentContent])

  // 加载笔记内容
  useEffect(() => {
    const loadNoteContent = async () => {
      if (activeNodeId && notesTree.length > 0) {
        setIsLoading(true)
        try {
          const activeNode = findNodeById(notesTree, activeNodeId)
          logger.debug('Active node:', activeNode)
          if (activeNode && activeNode.type === 'file' && activeNode.id) {
            try {
              const content = await window.api.file.readExternal(activeNode.externalPath)
              setCurrentContent(content)
            } catch (error) {
              logger.error('Failed to read file:', error as Error)
              setCurrentContent('')
            }
          }
        } catch (error) {
          logger.error('Failed to load note content:', error as Error)
          setCurrentContent('')
        } finally {
          setIsLoading(false)
        }
      } else if (!activeNodeId) {
        setCurrentContent('')
      }
    }

    loadNoteContent()
    // eslint-disable-next-line
  }, [activeNodeId, notesTree.length, findNodeById])

  // 创建文件夹
  const handleCreateFolder = useCallback(
    async (name: string) => {
      try {
        if (!notesPath) {
          throw new Error('No folder path selected')
        }
        await createFolder(name, notesPath)
      } catch (error) {
        logger.error('Failed to create folder:', error as Error)
      }
    },
    [notesPath]
  )

  // 创建笔记
  const handleCreateNote = useCallback(
    async (name: string) => {
      try {
        if (!notesPath) {
          throw new Error('No folder path selected')
        }
        const newNote = await createNote(name, '', notesPath)
        dispatch(setActiveNodeId(newNote.id))
      } catch (error) {
        logger.error('Failed to create note:', error as Error)
      }
    },
    [dispatch, notesPath]
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
          dispatch(setActiveNodeId(node.id))
        } catch (error) {
          logger.error('Failed to load note:', error as Error)
        }
      } else if (node.type === 'folder') {
        await handleToggleExpanded(node.id)
      }
    },
    [dispatch, handleToggleExpanded] // 移除 notesTree 和 findNodeById 依赖
  )

  // 删除节点
  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      try {
        const isActiveNodeOrParent =
          activeNodeId && (nodeId === activeNodeId || isParentNode(notesTree, nodeId, activeNodeId))

        await deleteNode(nodeId)

        // 如果删除的是当前活动节点，清空编辑器
        if (isActiveNodeOrParent) {
          dispatch(setActiveNodeId(undefined))
          setCurrentContent('')
          if (editorRef.current) {
            editorRef.current.clear()
          }
        }
      } catch (error) {
        logger.error('Failed to delete node:', error as Error)
      }
    },
    [activeNodeId, notesTree, dispatch]
  )

  // 重命名节点
  const handleRenameNode = useCallback(async (nodeId: string, newName: string) => {
    try {
      await renameNode(nodeId, newName)
    } catch (error) {
      logger.error('Failed to rename node:', error as Error)
    }
  }, [])

  // 处理文件上传
  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      try {
        setIsLoading(true)
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
      } finally {
        setIsLoading(false)
      }
    },
    [notesPath, t]
  )

  // 处理节点移动
  const handleMoveNode = useCallback(
    async (sourceNodeId: string, targetNodeId: string, position: 'before' | 'after' | 'inside') => {
      try {
        const success = await moveNode(sourceNodeId, targetNodeId, position)
        if (success) {
          logger.debug(`Move node ${sourceNodeId} ${position} node ${targetNodeId}`)
        } else {
          logger.error(`Failed to move node ${sourceNodeId} ${position} node ${targetNodeId}`)
        }
      } catch (error) {
        logger.error('Failed to move nodes:', error as Error)
      }
    },
    []
  )

  // 处理节点排序
  const handleSortNodes = useCallback(async (sortType: NotesSortType) => {
    try {
      logger.info(`Sorting notes with type: ${sortType}`)
      await sortAllLevels(sortType)
    } catch (error) {
      logger.error('Failed to sort notes:', error as Error)
      throw error
    }
  }, [])

  const getCurrentNoteContent = useCallback(() => {
    if (settings.editorMode === 'source') {
      return currentContent
    } else {
      return editorRef.current?.getMarkdown() || currentContent
    }
  }, [currentContent, settings.editorMode])

  return (
    <Container id="notes-page">
      <ContentContainer id="content-container">
        {showWorkspace && (
          <NotesSidebar
            notesTree={notesTree}
            activeNodeId={activeNodeId}
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
            activeNodeId={activeNodeId}
            currentContent={currentContent}
            tokenCount={tokenCount}
            isLoading={isLoading}
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
