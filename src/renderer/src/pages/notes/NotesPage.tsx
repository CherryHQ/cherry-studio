import { loggerService } from '@logger'
import { EditIcon } from '@renderer/components/Icons'
import { HSpaceBetweenStack } from '@renderer/components/Layout'
import RichEditor from '@renderer/components/RichEditor'
import { RichEditorRef } from '@renderer/components/RichEditor/types'
import { useSettings } from '@renderer/hooks/useSettings'
import HeaderNavbar from '@renderer/pages/notes/HeaderNavbar'
import NotesNavbar from '@renderer/pages/notes/NotesNavbar'
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
import { Button, Empty, Spin } from 'antd'
import { Eye } from 'lucide-react'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import NotesSidebar from './NotesSidebar'

const logger = loggerService.withContext('NotesPage')

const NotesPage: FC = () => {
  const editorRef = useRef<RichEditorRef>(null)
  const { t } = useTranslation()
  const { showWorkspace } = useSettings()
  const dispatch = useAppDispatch()
  const activeNodeId = useAppSelector(selectActiveNodeId)
  const [notesTree, setNotesTree] = useState<NotesTreeNode[]>([])
  const [currentContent, setCurrentContent] = useState<string>('')
  const [tokenCount, setTokenCount] = useState(0)
  const [showPreview, setShowPreview] = useState(false)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isSwitchingMode, setIsSwitchingMode] = useState<boolean>(false)

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
          await updateNote(activeNode, content)
        }
      } catch (error) {
        logger.error('Failed to save note:', error as Error)
      }
    },
    [activeNodeId, currentContent, findNodeById, notesTree]
  )

  const onSave = () => {
    const newMarkdown = editorRef.current?.getMarkdown() || ''
    setCurrentContent(newMarkdown)
    saveCurrentNote(newMarkdown)
  }

  const handleCommandsReady = (commandAPI: Pick<RichEditorRef, 'unregisterCommand'>) => {
    const disabledCommands = ['image', 'inlineMath']
    disabledCommands.forEach((commandId) => {
      commandAPI.unregisterCommand(commandId)
    })
  }

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
          if (activeNode && activeNode.type === 'file' && activeNode.fileId) {
            try {
              const fileMetadata = await FileManager.getFile(activeNode.fileId)
              logger.debug('File metadata:', fileMetadata)
              if (fileMetadata) {
                const content = await window.api.file.read(fileMetadata.id + fileMetadata.ext)
                logger.debug(content)
                setCurrentContent(content)
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
  const handleCreateFolder = async (name: string, parentId?: string) => {
    try {
      await createFolder(name, parentId)
      const updatedTree = await getNotesTree()
      setNotesTree(updatedTree)
    } catch (error) {
      logger.error('Failed to create folder:', error as Error)
    }
  }

  // 创建笔记
  const handleCreateNote = async (name: string, parentId?: string) => {
    try {
      const newNote = await createNote(name, '', parentId)
      const updatedTree = await getNotesTree()
      setNotesTree(updatedTree)
      dispatch(setActiveNodeId(newNote.id))
    } catch (error) {
      logger.error('Failed to create note:', error as Error)
    }
  }

  // 选择节点
  const handleSelectNode = async (node: NotesTreeNode) => {
    if (node.type === 'file') {
      try {
        dispatch(setActiveNodeId(node.id))

        if (node.fileId) {
          const updatedFileMetadata = await FileManager.getFile(node.fileId)
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
      } catch (error) {
        logger.error('Failed to load note:', error as Error)
      }
    } else if (node.type === 'folder') {
      // 切换文件夹展开状态
      await handleToggleExpanded(node.id)
    }
  }

  // 删除节点
  const handleDeleteNode = async (nodeId: string) => {
    try {
      const isActiveNodeOrParent =
        activeNodeId && (nodeId === activeNodeId || isParentNode(notesTree, nodeId, activeNodeId))

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
  }

  // 重命名节点
  const handleRenameNode = async (nodeId: string, newName: string) => {
    try {
      await renameNode(nodeId, newName)
      const updatedTree = await getNotesTree()
      setNotesTree(updatedTree)
    } catch (error) {
      logger.error('Failed to rename node:', error as Error)
    }
  }

  // 切换展开状态
  const handleToggleExpanded = async (nodeId: string) => {
    try {
      await toggleNodeExpanded(nodeId)
      const updatedTree = await getNotesTree()
      setNotesTree(updatedTree)
    } catch (error) {
      logger.error('Failed to toggle expanded:', error as Error)
    }
  }

  // 切换收藏状态
  const handleToggleStar = async (nodeId: string) => {
    try {
      await toggleStarred(nodeId)
      const updatedTree = await getNotesTree()
      setNotesTree(updatedTree)
    } catch (error) {
      window.message.error(t('notes.starred_failed'))
      logger.error(`Failed to toggle star for note: ${error}`)
    }
  }

  // 处理文件上传
  const handleUploadFiles = async (files: File[]) => {
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
  }

  // 处理节点移动
  const handleMoveNode = async (
    sourceNodeId: string,
    targetNodeId: string,
    position: 'before' | 'after' | 'inside'
  ) => {
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
  }

  // 处理节点排序
  const handleSortNodes = async (sortType: NotesSortType) => {
    try {
      logger.info(`Sorting notes with type: ${sortType}`)
      await sortAllLevels(sortType)
      const updatedTree = await getNotesTree()
      setNotesTree(updatedTree)
    } catch (error) {
      logger.error('Failed to sort notes:', error as Error)
      throw error
    }
  }

  return (
    <Container id="notes-page">
      <NotesNavbar />
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
          <HeaderNavbarContainer>
            <HeaderNavbar notesTree={notesTree} />
          </HeaderNavbarContainer>
          {activeNodeId ? (
            <EditorContainer>
              {isLoading ? (
                <LoadingContainer>
                  <Spin tip={t('common.loading')} />
                </LoadingContainer>
              ) : (
                <>
                  <RichEditorContainer>
                    <RichEditor
                      key={`${activeNodeId}-${showPreview ? 'preview' : 'edit'}`}
                      ref={editorRef}
                      initialContent={currentContent}
                      onCommandsReady={handleCommandsReady}
                      showToolbar={!showPreview}
                      editable={!showPreview}
                      showTableOfContents
                      enableContentSearch
                      className="notes-rich-editor"
                    />
                  </RichEditorContainer>
                  <BottomPanel>
                    <HSpaceBetweenStack width="100%" justifyContent="space-between" alignItems="center">
                      <TokenCount>
                        {t('notes.characters')}: {tokenCount}
                      </TokenCount>
                      <Button
                        type="primary"
                        size="small"
                        icon={showPreview ? <EditIcon size={14} /> : <Eye size={14} />}
                        loading={isSwitchingMode}
                        disabled={isSwitchingMode}
                        onClick={async () => {
                          if (isSwitchingMode) return

                          setIsSwitchingMode(true)
                          const currentScrollTop = editorRef.current?.getScrollTop?.() || 0

                          try {
                            if (showPreview) {
                              await new Promise((resolve) => {
                                requestAnimationFrame(() => {
                                  setShowPreview(false)
                                  requestAnimationFrame(() => {
                                    editorRef.current?.setScrollTop?.(currentScrollTop)
                                    resolve(void 0)
                                  })
                                })
                              })
                            } else {
                              onSave()
                              await new Promise((resolve) => {
                                requestAnimationFrame(() => {
                                  setShowPreview(true)
                                  requestAnimationFrame(() => {
                                    editorRef.current?.setScrollTop?.(currentScrollTop)
                                    resolve(void 0)
                                  })
                                })
                              })
                            }
                          } finally {
                            // 添加一个小延迟确保过渡完成
                            setTimeout(() => {
                              setIsSwitchingMode(false)
                            }, 100)
                          }
                        }}>
                        {isSwitchingMode ? t('common.loading') : showPreview ? t('common.edit') : t('common.preview')}
                      </Button>
                    </HSpaceBetweenStack>
                  </BottomPanel>
                </>
              )}
            </EditorContainer>
          ) : (
            <Empty description={t('notes.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </EditorWrapper>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
`

const LoadingContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  overflow: hidden;
`

const EditorWrapper = styled.div`
  flex: 1;
  display: flex;
  position: relative;
  overflow: hidden;
  flex-direction: column;
`

const HeaderNavbarContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 0 16px;
  height: 40px;
  border-bottom: 1px solid var(--color-border);
  justify-content: flex-start;
  width: 100%;
`

const EditorContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  margin: 16px;
  border: 0.5px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-background);
`

const RichEditorContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: opacity 0.2s ease-in-out;

  .notes-rich-editor {
    border: none;
    flex: 1;
    background: transparent;

    .rich-editor-wrapper {
      height: 100%;
      display: flex;
      flex-direction: column;
      transition: all 0.15s ease-in-out;
    }

    .rich-editor-content {
      flex: 1;
      overflow: auto;
      padding: 16px;
      transition: all 0.15s ease-in-out;
    }

    /* 预览模式下的样式优化 */
    &[data-preview='true'] {
      .ProseMirror {
        cursor: default !important;
      }
    }
  }
`

const BottomPanel = styled.div`
  padding: 8px 16px;
  border-top: 1px solid var(--color-border);
  background: var(--color-background-soft);
  flex-shrink: 0;
`

const TokenCount = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  user-select: none;
  line-height: 1;
`

export default NotesPage
