import { loggerService } from '@logger'
import { DeleteIcon } from '@renderer/components/Icons'
import SaveToKnowledgePopup from '@renderer/components/Popups/SaveToKnowledgePopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { useInPlaceEdit } from '@renderer/hooks/useInPlaceEdit'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import { useActiveNode } from '@renderer/hooks/useNotesQuery'
import NotesSidebarHeader from '@renderer/pages/notes/NotesSidebarHeader'
import { fetchNoteSummary } from '@renderer/services/ApiService'
import { RootState, useAppSelector } from '@renderer/store'
import { selectSortType } from '@renderer/store/note'
import { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import { exportNote } from '@renderer/utils/export'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Dropdown, Input, InputRef, MenuProps } from 'antd'
import { ItemType, MenuItemType } from 'antd/es/menu/interface'
import {
  ChevronDown,
  ChevronRight,
  Edit3,
  File,
  FilePlus,
  FileSearch,
  Folder,
  FolderOpen,
  Sparkles,
  Star,
  StarOff,
  UploadIcon
} from 'lucide-react'
import { FC, memo, Ref, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

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
  selectedFolderId?: string | null
}

const logger = loggerService.withContext('NotesSidebar')

interface TreeNodeProps {
  node: NotesTreeNode
  depth: number
  selectedFolderId?: string | null
  activeNodeId?: string
  editingNodeId: string | null
  renamingNodeIds: Set<string>
  newlyRenamedNodeIds: Set<string>
  draggedNodeId: string | null
  dragOverNodeId: string | null
  dragPosition: 'before' | 'inside' | 'after'
  inPlaceEdit: any
  getMenuItems: (node: NotesTreeNode) => any[]
  onSelectNode: (node: NotesTreeNode) => void
  onToggleExpanded: (nodeId: string) => void
  onDragStart: (e: React.DragEvent, node: NotesTreeNode) => void
  onDragOver: (e: React.DragEvent, node: NotesTreeNode) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, node: NotesTreeNode) => void
  onDragEnd: () => void
  renderChildren?: boolean // 控制是否渲染子节点
  openDropdownKey: string | null
  onDropdownOpenChange: (key: string | null) => void
}

const TreeNode = memo<TreeNodeProps>(
  ({
    node,
    depth,
    selectedFolderId,
    activeNodeId,
    editingNodeId,
    renamingNodeIds,
    newlyRenamedNodeIds,
    draggedNodeId,
    dragOverNodeId,
    dragPosition,
    inPlaceEdit,
    getMenuItems,
    onSelectNode,
    onToggleExpanded,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
    renderChildren = true,
    openDropdownKey,
    onDropdownOpenChange
  }) => {
    const { t } = useTranslation()

    const isActive = selectedFolderId
      ? node.type === 'folder' && node.id === selectedFolderId
      : node.id === activeNodeId
    const isEditing = editingNodeId === node.id && inPlaceEdit.isEditing
    const isRenaming = renamingNodeIds.has(node.id)
    const isNewlyRenamed = newlyRenamedNodeIds.has(node.id)
    const hasChildren = node.children && node.children.length > 0
    const isDragging = draggedNodeId === node.id
    const isDragOver = dragOverNodeId === node.id
    const isDragBefore = isDragOver && dragPosition === 'before'
    const isDragInside = isDragOver && dragPosition === 'inside'
    const isDragAfter = isDragOver && dragPosition === 'after'

    const getNodeNameClassName = () => {
      if (isRenaming) return 'shimmer'
      if (isNewlyRenamed) return 'typing'
      return ''
    }

    return (
      <div key={node.id}>
        <Dropdown
          menu={{ items: getMenuItems(node) }}
          trigger={['contextMenu']}
          open={openDropdownKey === node.id}
          onOpenChange={(open) => onDropdownOpenChange(open ? node.id : null)}>
          <div onContextMenu={(e) => e.stopPropagation()}>
            <TreeNodeContainer
              active={isActive}
              depth={depth}
              isDragging={isDragging}
              isDragOver={isDragOver}
              isDragBefore={isDragBefore}
              isDragInside={isDragInside}
              isDragAfter={isDragAfter}
              draggable={!isEditing}
              data-node-id={node.id}
              onDragStart={(e) => onDragStart(e, node)}
              onDragOver={(e) => onDragOver(e, node)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, node)}
              onDragEnd={onDragEnd}>
              <TreeNodeContent onClick={() => onSelectNode(node)}>
                <NodeIndent depth={depth} />

                {node.type === 'folder' && (
                  <ExpandIcon
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleExpanded(node.id)
                    }}
                    title={node.expanded ? t('notes.collapse') : t('notes.expand')}>
                    {node.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </ExpandIcon>
                )}

                <NodeIcon>
                  {node.type === 'folder' ? (
                    node.expanded ? (
                      <FolderOpen size={16} />
                    ) : (
                      <Folder size={16} />
                    )
                  ) : (
                    <File size={16} />
                  )}
                </NodeIcon>

                {isEditing ? (
                  <EditInput
                    ref={inPlaceEdit.inputRef as Ref<InputRef>}
                    value={inPlaceEdit.editValue}
                    onChange={inPlaceEdit.handleInputChange}
                    onBlur={inPlaceEdit.saveEdit}
                    onKeyDown={inPlaceEdit.handleKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    size="small"
                  />
                ) : (
                  <NodeName className={getNodeNameClassName()}>{node.name}</NodeName>
                )}
              </TreeNodeContent>
            </TreeNodeContainer>
          </div>
        </Dropdown>

        {renderChildren && node.type === 'folder' && node.expanded && hasChildren && (
          <div>
            {node.children!.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                selectedFolderId={selectedFolderId}
                activeNodeId={activeNodeId}
                editingNodeId={editingNodeId}
                renamingNodeIds={renamingNodeIds}
                newlyRenamedNodeIds={newlyRenamedNodeIds}
                draggedNodeId={draggedNodeId}
                dragOverNodeId={dragOverNodeId}
                dragPosition={dragPosition}
                inPlaceEdit={inPlaceEdit}
                getMenuItems={getMenuItems}
                onSelectNode={onSelectNode}
                onToggleExpanded={onToggleExpanded}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onDragEnd={onDragEnd}
                renderChildren={renderChildren}
                openDropdownKey={openDropdownKey}
                onDropdownOpenChange={onDropdownOpenChange}
              />
            ))}
          </div>
        )}
      </div>
    )
  }
)

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
  selectedFolderId
}) => {
  const { t } = useTranslation()
  const { bases } = useKnowledgeBases()
  const { activeNode } = useActiveNode(notesTree)
  const sortType = useAppSelector(selectSortType)
  const exportMenuOptions = useSelector((state: RootState) => state.settings.exportMenuOptions)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [renamingNodeIds, setRenamingNodeIds] = useState<Set<string>>(new Set())
  const [newlyRenamedNodeIds, setNewlyRenamedNodeIds] = useState<Set<string>>(new Set())
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null)
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null)
  const [dragPosition, setDragPosition] = useState<'before' | 'inside' | 'after'>('inside')
  const [isShowStarred, setIsShowStarred] = useState(false)
  const [isShowSearch, setIsShowSearch] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [isDragOverSidebar, setIsDragOverSidebar] = useState(false)
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null)
  const dragNodeRef = useRef<HTMLDivElement | null>(null)
  const scrollbarRef = useRef<any>(null)

  const inPlaceEdit = useInPlaceEdit({
    onSave: (newName: string) => {
      if (editingNodeId && newName) {
        onRenameNode(editingNodeId, newName)
        logger.debug(`Renamed node ${editingNodeId} to "${newName}"`)
      }
      setEditingNodeId(null)
    },
    onCancel: () => {
      setEditingNodeId(null)
    }
  })

  // 滚动到活动节点
  useEffect(() => {
    if (activeNode?.id && !isShowStarred && !isShowSearch && scrollbarRef.current) {
      // 延迟一下确保DOM已更新
      setTimeout(() => {
        const scrollContainer = scrollbarRef.current as HTMLElement
        if (scrollContainer) {
          const activeElement = scrollContainer.querySelector(`[data-node-id="${activeNode.id}"]`) as HTMLElement
          if (activeElement) {
            // 获取元素相对于滚动容器的位置
            const containerHeight = scrollContainer.clientHeight
            const elementOffsetTop = activeElement.offsetTop
            const elementHeight = activeElement.offsetHeight
            const currentScrollTop = scrollContainer.scrollTop

            // 检查元素是否在可视区域内
            const elementTop = elementOffsetTop
            const elementBottom = elementOffsetTop + elementHeight
            const viewTop = currentScrollTop
            const viewBottom = currentScrollTop + containerHeight

            // 如果元素不在可视区域内，滚动到中心位置
            if (elementTop < viewTop || elementBottom > viewBottom) {
              const targetScrollTop = elementOffsetTop - (containerHeight - elementHeight) / 2
              scrollContainer.scrollTo({
                top: Math.max(0, targetScrollTop),
                behavior: 'instant'
              })
            }
          }
        }
      }, 200)
    }
  }, [activeNode?.id, isShowStarred, isShowSearch])

  const handleCreateFolder = useCallback(() => {
    onCreateFolder(t('notes.untitled_folder'))
  }, [onCreateFolder, t])

  const handleCreateNote = useCallback(() => {
    onCreateNote(t('notes.untitled_note'))
  }, [onCreateNote, t])

  const handleSelectSortType = useCallback(
    (selectedSortType: NotesSortType) => {
      onSortNodes(selectedSortType)
    },
    [onSortNodes]
  )

  const handleStartEdit = useCallback(
    (node: NotesTreeNode) => {
      setEditingNodeId(node.id)
      inPlaceEdit.startEdit(node.name)
    },
    [inPlaceEdit]
  )

  const handleDeleteNode = useCallback(
    (node: NotesTreeNode) => {
      const confirmText =
        node.type === 'folder'
          ? t('notes.delete_folder_confirm', { name: node.name })
          : t('notes.delete_note_confirm', { name: node.name })

      window.modal.confirm({
        title: t('notes.delete'),
        content: confirmText,
        centered: true,
        okButtonProps: { danger: true },
        onOk: () => {
          onDeleteNode(node.id)
        }
      })
    },
    [onDeleteNode, t]
  )

  const handleExportKnowledge = useCallback(
    async (note: NotesTreeNode) => {
      try {
        if (bases.length === 0) {
          window.toast.warning(t('chat.save.knowledge.empty.no_knowledge_base'))
          return
        }

        const result = await SaveToKnowledgePopup.showForNote(note)

        if (result?.success) {
          window.toast.success(t('notes.export_success', { count: result.savedCount }))
        }
      } catch (error) {
        window.toast.error(t('notes.export_failed'))
        logger.error(`Failed to export note to knowledge base: ${error}`)
      }
    },
    [bases.length, t]
  )

  const handleAutoRename = useCallback(
    async (note: NotesTreeNode) => {
      if (note.type !== 'file') return

      setRenamingNodeIds((prev) => new Set(prev).add(note.id))
      try {
        const content = await window.api.file.readExternal(note.externalPath)
        if (!content || content.trim().length === 0) {
          window.toast.warning(t('notes.auto_rename.empty_note'))
          return
        }

        const summaryText = await fetchNoteSummary({ content })
        if (summaryText) {
          onRenameNode(note.id, summaryText)
          window.toast.success(t('notes.auto_rename.success'))
        } else {
          window.toast.error(t('notes.auto_rename.failed'))
        }
      } catch (error) {
        window.toast.error(t('notes.auto_rename.failed'))
        logger.error(`Failed to auto-rename note: ${error}`)
      } finally {
        setRenamingNodeIds((prev) => {
          const next = new Set(prev)
          next.delete(note.id)
          return next
        })

        setNewlyRenamedNodeIds((prev) => new Set(prev).add(note.id))

        setTimeout(() => {
          setNewlyRenamedNodeIds((prev) => {
            const next = new Set(prev)
            next.delete(note.id)
            return next
          })
        }, 700)
      }
    },
    [onRenameNode, t]
  )

  const handleDragStart = useCallback((e: React.DragEvent, node: NotesTreeNode) => {
    setDraggedNodeId(node.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', node.id)

    dragNodeRef.current = e.currentTarget as HTMLDivElement

    if (e.currentTarget.parentElement) {
      const rect = e.currentTarget.getBoundingClientRect()
      const ghostElement = e.currentTarget.cloneNode(true) as HTMLElement
      ghostElement.style.width = `${rect.width}px`
      ghostElement.style.opacity = '0.7'
      ghostElement.style.position = 'absolute'
      ghostElement.style.top = '-1000px'
      document.body.appendChild(ghostElement)
      e.dataTransfer.setDragImage(ghostElement, 10, 10)
      setTimeout(() => {
        document.body.removeChild(ghostElement)
      }, 0)
    }
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent, node: NotesTreeNode) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

      if (draggedNodeId === node.id) {
        return
      }

      setDragOverNodeId(node.id)

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const mouseY = e.clientY
      const thresholdTop = rect.top + rect.height * 0.3
      const thresholdBottom = rect.bottom - rect.height * 0.3

      if (mouseY < thresholdTop) {
        setDragPosition('before')
      } else if (mouseY > thresholdBottom) {
        setDragPosition('after')
      } else {
        setDragPosition(node.type === 'folder' ? 'inside' : 'after')
      }
    },
    [draggedNodeId]
  )

  const handleDragLeave = useCallback(() => {
    setDragOverNodeId(null)
    setDragPosition('inside')
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent, targetNode: NotesTreeNode) => {
      e.preventDefault()
      const draggedId = e.dataTransfer.getData('text/plain')

      if (draggedId && draggedId !== targetNode.id) {
        onMoveNode(draggedId, targetNode.id, dragPosition)
      }

      setDraggedNodeId(null)
      setDragOverNodeId(null)
      setDragPosition('inside')
    },
    [onMoveNode, dragPosition]
  )

  const handleDragEnd = useCallback(() => {
    setDraggedNodeId(null)
    setDragOverNodeId(null)
    setDragPosition('inside')
  }, [])

  const handleToggleStarredView = useCallback(() => {
    setIsShowStarred(!isShowStarred)
  }, [isShowStarred])

  const handleToggleSearchView = useCallback(() => {
    setIsShowSearch(!isShowSearch)
  }, [isShowSearch])

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
        if (isShowSearch && searchKeyword) {
          if (node.type === 'file' && node.name.toLowerCase().includes(searchKeyword.toLowerCase())) {
            result.push(node)
          }
        } else if (isShowStarred) {
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

    if (isShowStarred || isShowSearch) {
      // For filtered views, return flat list without virtualization for simplicity
      const filteredNodes = flattenForFiltering(notesTree)
      return filteredNodes.map((node) => ({ node, depth: 0 }))
    }

    // For normal tree view, use hierarchical flattening for virtualization
    return flattenForVirtualization(notesTree)
  }, [notesTree, isShowStarred, isShowSearch, searchKeyword])

  // Use virtualization only for normal tree view with many items
  const shouldUseVirtualization = !isShowStarred && !isShowSearch && flattenedNodes.length > 100

  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: flattenedNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28, // Estimated height of each tree item
    overscan: 10
  })

  const filteredTree = useMemo(() => {
    if (isShowStarred || isShowSearch) {
      return flattenedNodes.map(({ node }) => node)
    }
    return notesTree
  }, [flattenedNodes, isShowStarred, isShowSearch, notesTree])

  const getMenuItems = useCallback(
    (node: NotesTreeNode) => {
      const baseMenuItems: MenuProps['items'] = []

      // only show auto rename for file for now
      if (node.type !== 'folder') {
        baseMenuItems.push({
          label: t('notes.auto_rename.label'),
          key: 'auto-rename',
          icon: <Sparkles size={14} />,
          disabled: renamingNodeIds.has(node.id),
          onClick: () => {
            handleAutoRename(node)
          }
        })
      }

      if (node.type === 'folder') {
        baseMenuItems.push(
          {
            label: t('notes.new_note'),
            key: 'new_note',
            icon: <FilePlus size={14} />,
            onClick: () => {
              onCreateNote(t('notes.untitled_note'), node.id)
            }
          },
          {
            label: t('notes.new_folder'),
            key: 'new_folder',
            icon: <Folder size={14} />,
            onClick: () => {
              onCreateFolder(t('notes.untitled_folder'), node.id)
            }
          },
          { type: 'divider' }
        )
      }

      baseMenuItems.push(
        {
          label: t('notes.rename'),
          key: 'rename',
          icon: <Edit3 size={14} />,
          onClick: () => {
            handleStartEdit(node)
          }
        },
        {
          label: t('notes.open_outside'),
          key: 'open_outside',
          icon: <FolderOpen size={14} />,
          onClick: () => {
            window.api.openPath(node.externalPath)
          }
        }
      )
      if (node.type !== 'folder') {
        baseMenuItems.push(
          {
            label: node.isStarred ? t('notes.unstar') : t('notes.star'),
            key: 'star',
            icon: node.isStarred ? <StarOff size={14} /> : <Star size={14} />,
            onClick: () => {
              onToggleStar(node.id)
            }
          },
          {
            label: t('notes.export_knowledge'),
            key: 'export_knowledge',
            icon: <FileSearch size={14} />,
            onClick: () => {
              handleExportKnowledge(node)
            }
          },
          {
            label: t('chat.topics.export.title'),
            key: 'export',
            icon: <UploadIcon size={14} />,
            children: [
              exportMenuOptions.markdown && {
                label: t('chat.topics.export.md.label'),
                key: 'markdown',
                onClick: () => exportNote({ node, platform: 'markdown' })
              },
              exportMenuOptions.docx && {
                label: t('chat.topics.export.word'),
                key: 'word',
                onClick: () => exportNote({ node, platform: 'docx' })
              },
              exportMenuOptions.notion && {
                label: t('chat.topics.export.notion'),
                key: 'notion',
                onClick: () => exportNote({ node, platform: 'notion' })
              },
              exportMenuOptions.yuque && {
                label: t('chat.topics.export.yuque'),
                key: 'yuque',
                onClick: () => exportNote({ node, platform: 'yuque' })
              },
              exportMenuOptions.obsidian && {
                label: t('chat.topics.export.obsidian'),
                key: 'obsidian',
                onClick: () => exportNote({ node, platform: 'obsidian' })
              },
              exportMenuOptions.joplin && {
                label: t('chat.topics.export.joplin'),
                key: 'joplin',
                onClick: () => exportNote({ node, platform: 'joplin' })
              },
              exportMenuOptions.siyuan && {
                label: t('chat.topics.export.siyuan'),
                key: 'siyuan',
                onClick: () => exportNote({ node, platform: 'siyuan' })
              }
            ].filter(Boolean) as ItemType<MenuItemType>[]
          }
        )
      }
      baseMenuItems.push(
        { type: 'divider' },
        {
          label: t('notes.delete'),
          danger: true,
          key: 'delete',
          icon: <DeleteIcon size={14} className="lucide-custom" />,
          onClick: () => {
            handleDeleteNode(node)
          }
        }
      )

      return baseMenuItems
    },
    [
      t,
      handleStartEdit,
      onToggleStar,
      handleExportKnowledge,
      handleDeleteNode,
      renamingNodeIds,
      handleAutoRename,
      exportMenuOptions,
      onCreateNote,
      onCreateFolder
    ]
  )

  const handleDropFiles = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOverSidebar(false)

      // 处理文件夹拖拽：从 dataTransfer.items 获取完整的文件路径信息
      const items = Array.from(e.dataTransfer.items)
      const files: File[] = []

      const processEntry = async (entry: FileSystemEntry, path: string = '') => {
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry
          return new Promise<void>((resolve) => {
            fileEntry.file((file) => {
              // 手动设置 webkitRelativePath 以保持文件夹结构
              Object.defineProperty(file, 'webkitRelativePath', {
                value: path + file.name,
                writable: false
              })
              files.push(file)
              resolve()
            })
          })
        } else if (entry.isDirectory) {
          const dirEntry = entry as FileSystemDirectoryEntry
          const reader = dirEntry.createReader()
          return new Promise<void>((resolve) => {
            reader.readEntries(async (entries) => {
              const promises = entries.map((subEntry) => processEntry(subEntry, path + entry.name + '/'))
              await Promise.all(promises)
              resolve()
            })
          })
        }
      }

      // 如果支持 DataTransferItem API（文件夹拖拽）
      if (items.length > 0 && items[0].webkitGetAsEntry()) {
        const promises = items.map((item) => {
          const entry = item.webkitGetAsEntry()
          return entry ? processEntry(entry) : Promise.resolve()
        })

        await Promise.all(promises)

        if (files.length > 0) {
          onUploadFiles(files)
        }
      } else {
        const regularFiles = Array.from(e.dataTransfer.files)
        if (regularFiles.length > 0) {
          onUploadFiles(regularFiles)
        }
      }
    },
    [onUploadFiles]
  )

  const handleClickToSelectFiles = useCallback(() => {
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.multiple = true
    fileInput.accept = '.md,.markdown'
    fileInput.webkitdirectory = false

    fileInput.onchange = (e) => {
      const target = e.target as HTMLInputElement
      if (target.files && target.files.length > 0) {
        const selectedFiles = Array.from(target.files)
        onUploadFiles(selectedFiles)
      }
      fileInput.remove()
    }

    fileInput.click()
  }, [onUploadFiles])

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
      }
    ]
  }, [t, handleCreateNote, handleCreateFolder])

  return (
    <SidebarContainer
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
        {shouldUseVirtualization ? (
          <Dropdown
            menu={{ items: getEmptyAreaMenuItems() }}
            trigger={['contextMenu']}
            open={openDropdownKey === 'empty-area'}
            onOpenChange={(open) => setOpenDropdownKey(open ? 'empty-area' : null)}>
            <VirtualizedTreeContainer ref={parentRef}>
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative'
                }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const { node, depth } = flattenedNodes[virtualItem.index]
                  return (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`
                      }}>
                      <div style={{ padding: '0 8px' }}>
                        <TreeNode
                          node={node}
                          depth={depth}
                          selectedFolderId={selectedFolderId}
                          activeNodeId={activeNode?.id}
                          editingNodeId={editingNodeId}
                          renamingNodeIds={renamingNodeIds}
                          newlyRenamedNodeIds={newlyRenamedNodeIds}
                          draggedNodeId={draggedNodeId}
                          dragOverNodeId={dragOverNodeId}
                          dragPosition={dragPosition}
                          inPlaceEdit={inPlaceEdit}
                          getMenuItems={getMenuItems}
                          onSelectNode={onSelectNode}
                          onToggleExpanded={onToggleExpanded}
                          onDragStart={handleDragStart}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          onDragEnd={handleDragEnd}
                          renderChildren={false}
                          openDropdownKey={openDropdownKey}
                          onDropdownOpenChange={setOpenDropdownKey}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
              {!isShowStarred && !isShowSearch && (
                <DropHintNode>
                  <TreeNodeContainer active={false} depth={0}>
                    <TreeNodeContent>
                      <NodeIcon>
                        <FilePlus size={16} />
                      </NodeIcon>
                      <DropHintText onClick={handleClickToSelectFiles}>{t('notes.drop_markdown_hint')}</DropHintText>
                    </TreeNodeContent>
                  </TreeNodeContainer>
                </DropHintNode>
              )}
            </VirtualizedTreeContainer>
          </Dropdown>
        ) : (
          <Dropdown
            menu={{ items: getEmptyAreaMenuItems() }}
            trigger={['contextMenu']}
            open={openDropdownKey === 'empty-area'}
            onOpenChange={(open) => setOpenDropdownKey(open ? 'empty-area' : null)}>
            <StyledScrollbar ref={scrollbarRef}>
              <TreeContent>
                {isShowStarred || isShowSearch
                  ? filteredTree.map((node) => (
                      <TreeNode
                        key={node.id}
                        node={node}
                        depth={0}
                        selectedFolderId={selectedFolderId}
                        activeNodeId={activeNode?.id}
                        editingNodeId={editingNodeId}
                        renamingNodeIds={renamingNodeIds}
                        newlyRenamedNodeIds={newlyRenamedNodeIds}
                        draggedNodeId={draggedNodeId}
                        dragOverNodeId={dragOverNodeId}
                        dragPosition={dragPosition}
                        inPlaceEdit={inPlaceEdit}
                        getMenuItems={getMenuItems}
                        onSelectNode={onSelectNode}
                        onToggleExpanded={onToggleExpanded}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
                        openDropdownKey={openDropdownKey}
                        onDropdownOpenChange={setOpenDropdownKey}
                      />
                    ))
                  : notesTree.map((node) => (
                      <TreeNode
                        key={node.id}
                        node={node}
                        depth={0}
                        selectedFolderId={selectedFolderId}
                        activeNodeId={activeNode?.id}
                        editingNodeId={editingNodeId}
                        renamingNodeIds={renamingNodeIds}
                        newlyRenamedNodeIds={newlyRenamedNodeIds}
                        draggedNodeId={draggedNodeId}
                        dragOverNodeId={dragOverNodeId}
                        dragPosition={dragPosition}
                        inPlaceEdit={inPlaceEdit}
                        getMenuItems={getMenuItems}
                        onSelectNode={onSelectNode}
                        onToggleExpanded={onToggleExpanded}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
                        openDropdownKey={openDropdownKey}
                        onDropdownOpenChange={setOpenDropdownKey}
                      />
                    ))}
                {!isShowStarred && !isShowSearch && (
                  <DropHintNode>
                    <TreeNodeContainer active={false} depth={0}>
                      <TreeNodeContent>
                        <NodeIcon>
                          <FilePlus size={16} />
                        </NodeIcon>
                        <DropHintText onClick={handleClickToSelectFiles}>{t('notes.drop_markdown_hint')}</DropHintText>
                      </TreeNodeContent>
                    </TreeNodeContainer>
                  </DropHintNode>
                )}
              </TreeContent>
            </StyledScrollbar>
          </Dropdown>
        )}
      </NotesTreeContainer>

      {isDragOverSidebar && <DragOverIndicator />}
    </SidebarContainer>
  )
}

const SidebarContainer = styled.div`
  width: 250px;
  min-width: 250px;
  height: calc(100vh - var(--navbar-height));
  background-color: var(--color-background);
  border-right: 0.5px solid var(--color-border);
  border-top-left-radius: 10px;
  display: flex;
  flex-direction: column;
  position: relative;
`

const NotesTreeContainer = styled.div`
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--navbar-height) - 45px);
`

const VirtualizedTreeContainer = styled.div`
  flex: 1;
  height: 100%;
  overflow: auto;
  position: relative;
  padding-top: 10px;
`

const StyledScrollbar = styled(Scrollbar)`
  flex: 1;
  height: 100%;
  min-height: 0;
`

const TreeContent = styled.div`
  padding: 8px;
`

const TreeNodeContainer = styled.div<{
  active: boolean
  depth: number
  isDragging?: boolean
  isDragOver?: boolean
  isDragBefore?: boolean
  isDragInside?: boolean
  isDragAfter?: boolean
}>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  margin-bottom: 2px;
  background-color: ${(props) => {
    if (props.isDragInside) return 'var(--color-primary-background)'
    if (props.active) return 'var(--color-background-soft)'
    return 'transparent'
  }};
  border: 0.5px solid
    ${(props) => {
      if (props.isDragInside) return 'var(--color-primary)'
      if (props.active) return 'var(--color-border)'
      return 'transparent'
    }};
  opacity: ${(props) => (props.isDragging ? 0.5 : 1)};
  transition: all 0.2s ease;
  position: relative;

  &:hover {
    background-color: var(--color-background-soft);

    .node-actions {
      opacity: 1;
    }
  }

  /* 添加拖拽指示线 */
  ${(props) =>
    props.isDragBefore &&
    `
    &::before {
      content: '';
      position: absolute;
      top: -2px;
      left: 0;
      right: 0;
      height: 2px;
      background-color: var(--color-primary);
      border-radius: 1px;
    }
  `}

  ${(props) =>
    props.isDragAfter &&
    `
    &::after {
      content: '';
      position: absolute;
      bottom: -2px;
      left: 0;
      right: 0;
      height: 2px;
      background-color: var(--color-primary);
      border-radius: 1px;
    }
  `}
`

const TreeNodeContent = styled.div`
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
`

const NodeIndent = styled.div<{ depth: number }>`
  width: ${(props) => props.depth * 16}px;
  flex-shrink: 0;
`

const ExpandIcon = styled.div`
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-2);
  margin-right: 4px;

  &:hover {
    color: var(--color-text);
  }
`

const NodeIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
  color: var(--color-text-2);
  flex-shrink: 0;
`

const NodeName = styled.div`
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  color: var(--color-text);
  position: relative;
  will-change: background-position, width;

  --color-shimmer-mid: var(--color-text-1);
  --color-shimmer-end: color-mix(in srgb, var(--color-text-1) 25%, transparent);

  &.shimmer {
    background: linear-gradient(to left, var(--color-shimmer-end), var(--color-shimmer-mid), var(--color-shimmer-end));
    background-size: 200% 100%;
    background-clip: text;
    color: transparent;
    animation: shimmer 3s linear infinite;
  }

  &.typing {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    animation: typewriter 0.5s steps(40, end);
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  @keyframes typewriter {
    from {
      width: 0;
    }
    to {
      width: 100%;
    }
  }
`

const EditInput = styled(Input)`
  flex: 1;
  font-size: 13px;
`

const DragOverIndicator = styled.div`
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

const DropHintNode = styled.div`
  margin: 8px;
  margin-bottom: 20px;

  ${TreeNodeContainer} {
    background-color: transparent;
    border: 1px dashed var(--color-border);
    cursor: default;
    opacity: 0.6;

    &:hover {
      background-color: var(--color-background-soft);
      opacity: 0.8;
    }
  }
`

const DropHintText = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
  font-style: italic;
`

export default memo(NotesSidebar)
