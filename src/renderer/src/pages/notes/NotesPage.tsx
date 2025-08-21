import { loggerService } from '@logger'
import { RichEditorRef } from '@renderer/components/RichEditor/types'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useSettings } from '@renderer/hooks/useSettings'
import FileManager from '@renderer/services/FileManager'
import {
  createFolder,
  createNote,
  deleteNode,
  getNotesTree,
  isParentNode,
  moveNode,
  renameNode,
  sortAllLevels,
  toggleNodeExpanded,
  toggleStarred,
  updateNote,
  uploadNote
} from '@renderer/services/NotesService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { selectActiveNodeId, setActiveNodeId } from '@renderer/store/note'
import { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
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
  const { settings, folderPath } = useNotesSettings()
  const [notesTree, setNotesTree] = useState<NotesTreeNode[]>([])
  const [currentContent, setCurrentContent] = useState<string>('')
  const [tokenCount, setTokenCount] = useState(0)
  const [isLoading, setIsLoading] = useState<boolean>(false)

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
          if (activeNode.isExternal && activeNode.externalPath) {
            await window.api.file.write(activeNode.externalPath, content)
          } else {
            await updateNote(activeNode, content)
          }
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

  // 初始化加载笔记树
  useEffect(() => {
    const loadNotesTree = async () => {
      try {
        const tree = await getNotesTree()
        logger.debug('Loaded notes tree:', tree)
        setNotesTree(tree)
      } catch (error) {
        logger.error('Failed to load notes tree:', error as Error)
      }
    }

    loadNotesTree()
  }, [])

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
              if (activeNode.isExternal && activeNode.externalPath) {
                const content = await window.api.file.readExternal(activeNode.externalPath)
                setCurrentContent(content)
              } else {
                const fileMetadata = await FileManager.getFile(activeNode.id)
                logger.debug('File metadata:', fileMetadata)
                if (fileMetadata) {
                  const content = await window.api.file.read(fileMetadata.id + fileMetadata.ext)
                  logger.debug(content)
                  setCurrentContent(content)
                }
              }
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
    async (name: string, parentId?: string) => {
      try {
        const hasExternalNodes = notesTree.some((node) => node.isExternal === true)
        logger.debug('Has external nodes:', { hasExternalNodes })
        if (hasExternalNodes) {
          await createFolder(name, parentId, true, folderPath)
        } else {
          await createFolder(name, parentId)
        }
        const updatedTree = await getNotesTree()
        setNotesTree(updatedTree)
      } catch (error) {
        logger.error('Failed to create folder:', error as Error)
      }
    },
    [folderPath, notesTree]
  )

  // 创建笔记
  const handleCreateNote = useCallback(
    async (name: string, parentId?: string) => {
      try {
        const newNote = await createNote(name, '', parentId)
        const updatedTree = await getNotesTree()
        setNotesTree(updatedTree)
        dispatch(setActiveNodeId(newNote.id))
      } catch (error) {
        logger.error('Failed to create note:', error as Error)
      }
    },
    [dispatch]
  )

  // 切换展开状态
  const handleToggleExpanded = useCallback(async (nodeId: string) => {
    try {
      await toggleNodeExpanded(nodeId)
      const updatedTree = await getNotesTree()
      setNotesTree(updatedTree)
    } catch (error) {
      logger.error('Failed to toggle expanded:', error as Error)
    }
  }, [])

  // 选择节点
  const handleSelectNode = useCallback(
    async (node: NotesTreeNode) => {
      if (node.type === 'file') {
        try {
          dispatch(setActiveNodeId(node.id))

          if (node.id) {
            if (!node.isExternal && node.externalPath) {
              const updatedFileMetadata = await FileManager.getFile(node.id)
              if (updatedFileMetadata && updatedFileMetadata.origin_name !== node.name) {
                // 如果数据库中的显示名称与树节点中的名称不同，更新树节点
                const updatedTree = [...notesTree]
                const updatedNode = findNodeById(updatedTree, node.id)
                if (updatedNode) {
                  updatedNode.name = updatedFileMetadata.origin_name
                  setNotesTree(updatedTree)
                }
              }
            }
          }
        } catch (error) {
          logger.error('Failed to load note:', error as Error)
        }
      } else if (node.type === 'folder') {
        // 切换文件夹展开状态
        await handleToggleExpanded(node.id)
      }
    },
    [dispatch, notesTree, findNodeById, handleToggleExpanded]
  )

  // 删除节点
  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      try {
        const isActiveNodeOrParent =
          activeNodeId && (nodeId === activeNodeId || isParentNode(notesTree, nodeId, activeNodeId))

        // FIXME 删除外部文件

        await deleteNode(nodeId)
        const updatedTree = await getNotesTree()
        setNotesTree(updatedTree)

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
      const updatedTree = await getNotesTree()
      setNotesTree(updatedTree)
    } catch (error) {
      logger.error('Failed to rename node:', error as Error)
    }
  }, [])

  // 切换收藏状态
  const handleToggleStar = useCallback(
    async (nodeId: string) => {
      try {
        await toggleStarred(nodeId)
        const updatedTree = await getNotesTree()
        setNotesTree(updatedTree)
      } catch (error) {
        window.message.error(t('notes.starred_failed'))
        logger.error(`Failed to toggle star for note: ${error}`)
      }
    },
    [t]
  )

  // 处理文件上传
  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      try {
        setIsLoading(true)
        const markdownFiles = Array.from(files).filter((file) => file.name.toLowerCase().endsWith('.md'))

        if (markdownFiles.length === 0) {
          window.message.warning(t('notes.only_markdown'))
          return
        }

        for (const file of markdownFiles) {
          try {
            await uploadNote(file)
          } catch (error) {
            logger.error(`Failed to upload note file ${file.name}:`, error as Error)
            window.message.error(t('notes.upload_failed', { name: file.name }))
          }
        }

        // 上传完成后刷新笔记树
        const updatedTree = await getNotesTree()
        setNotesTree(updatedTree)
        window.message.success(t('notes.upload_success', { count: markdownFiles.length }))
      } catch (error) {
        logger.error('Failed to handle file uploads:', error as Error)
        window.message.error(t('notes.upload_failed'))
      } finally {
        setIsLoading(false)
      }
    },
    [t]
  )

  // 处理节点移动
  const handleMoveNode = useCallback(
    async (sourceNodeId: string, targetNodeId: string, position: 'before' | 'after' | 'inside') => {
      try {
        const success = await moveNode(sourceNodeId, targetNodeId, position)
        if (success) {
          logger.debug(`Move node ${sourceNodeId} ${position} node ${targetNodeId}`)
          const updatedTree = await getNotesTree()
          setNotesTree(updatedTree)
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
      const updatedTree = await getNotesTree()
      setNotesTree(updatedTree)
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
