import Scrollbar from '@renderer/components/Scrollbar'
import { NotesTreeNode } from '@renderer/types/note'
import { Input, Tooltip } from 'antd'
import {
  ChevronDown,
  ChevronRight,
  Edit3,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Star,
  Trash2
} from 'lucide-react'
import { FC, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface NotesSidebarProps {
  onCreateFolder: (name: string, parentId?: string) => void
  onCreateNote: (name: string, parentId?: string) => void
  onSelectNode: (node: NotesTreeNode) => void
  onDeleteNode: (nodeId: string) => void
  onRenameNode: (nodeId: string, newName: string) => void
  onToggleStarred: (nodeId: string) => void
  onToggleExpanded: (nodeId: string) => void
  onMoveNode: (nodeId: string, targetParentId?: string) => void
  activeNodeId?: string
  notesTree: NotesTreeNode[]
}

const NotesSidebar: FC<NotesSidebarProps> = ({
  onCreateFolder,
  onCreateNote,
  onSelectNode,
  onDeleteNode,
  onRenameNode,
  onToggleStarred,
  onToggleExpanded,
  onMoveNode,
  activeNodeId,
  notesTree
}) => {
  const { t } = useTranslation()
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null)
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null)

  const handleCreateFolder = useCallback(() => {
    onCreateFolder(t('notes.untitled_folder'))
  }, [onCreateFolder, t])

  const handleCreateNote = useCallback(() => {
    onCreateNote(t('notes.untitled_note'))
  }, [onCreateNote, t])

  const handleStartEdit = useCallback((node: NotesTreeNode) => {
    setEditingNodeId(node.id)
    setEditingName(node.name)
  }, [])

  const handleFinishEdit = useCallback(() => {
    if (editingNodeId && editingName.trim()) {
      onRenameNode(editingNodeId, editingName.trim())
    }
    setEditingNodeId(null)
    setEditingName('')
  }, [editingNodeId, editingName, onRenameNode])

  const handleCancelEdit = useCallback(() => {
    setEditingNodeId(null)
    setEditingName('')
  }, [])

  const handleDeleteNode = useCallback(
    (node: NotesTreeNode) => {
      const confirmKey = node.type === 'folder' ? 'delete_folder_confirm' : 'delete_note_confirm'

      window.modal.confirm({
        title: t('notes.delete'),
        content: t(`notes.${confirmKey}`, { name: node.name }),
        centered: true,
        okButtonProps: { danger: true },
        onOk: () => {
          onDeleteNode(node.id)
        }
      })
    },
    [onDeleteNode, t]
  )

  const handleDragStart = useCallback((e: React.DragEvent, node: NotesTreeNode) => {
    setDraggedNodeId(node.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', node.id)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, node: NotesTreeNode) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverNodeId(node.id)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverNodeId(null)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent, targetNode: NotesTreeNode) => {
      e.preventDefault()
      const draggedId = e.dataTransfer.getData('text/plain')

      if (draggedId && draggedId !== targetNode.id) {
        const targetParentId = targetNode.type === 'folder' ? targetNode.id : undefined
        onMoveNode(draggedId, targetParentId)
      }

      setDraggedNodeId(null)
      setDragOverNodeId(null)
    },
    [onMoveNode]
  )

  const handleDragEnd = useCallback(() => {
    setDraggedNodeId(null)
    setDragOverNodeId(null)
  }, [])

  const renderTreeNode = useCallback(
    (node: NotesTreeNode, depth: number = 0) => {
      const isActive = node.id === activeNodeId
      const isEditing = editingNodeId === node.id
      const hasChildren = node.children && node.children.length > 0
      const isDragging = draggedNodeId === node.id
      const isDragOver = dragOverNodeId === node.id

      return (
        <div key={node.id}>
          <TreeNodeContainer
            active={isActive}
            depth={depth}
            isDragging={isDragging}
            isDragOver={isDragOver}
            draggable={!isEditing}
            onDragStart={(e) => handleDragStart(e, node)}
            onDragOver={(e) => handleDragOver(e, node)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, node)}
            onDragEnd={handleDragEnd}>
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
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onPressEnter={handleFinishEdit}
                  onBlur={handleFinishEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      handleCancelEdit()
                    }
                  }}
                  autoFocus
                  size="small"
                />
              ) : (
                <NodeName>{node.name}</NodeName>
              )}

              {node.is_starred && (
                <StarIcon>
                  <Star size={12} fill="var(--color-primary)" />
                </StarIcon>
              )}
            </TreeNodeContent>

            <NodeActions className="node-actions">
              <Tooltip title={node.is_starred ? t('notes.unstar') : t('notes.star')}>
                <ActionButton
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleStarred(node.id)
                  }}>
                  <Star size={14} fill={node.is_starred ? 'var(--color-primary)' : 'none'} />
                </ActionButton>
              </Tooltip>

              <Tooltip title={t('notes.rename')}>
                <ActionButton
                  onClick={(e) => {
                    e.stopPropagation()
                    handleStartEdit(node)
                  }}>
                  <Edit3 size={14} />
                </ActionButton>
              </Tooltip>

              <Tooltip title={t('notes.delete')}>
                <ActionButton
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteNode(node)
                  }}>
                  <Trash2 size={14} />
                </ActionButton>
              </Tooltip>
            </NodeActions>
          </TreeNodeContainer>

          {node.type === 'folder' && node.expanded && hasChildren && (
            <div>{node.children!.map((child) => renderTreeNode(child, depth + 1))}</div>
          )}
        </div>
      )
    },
    [
      activeNodeId,
      editingNodeId,
      editingName,
      draggedNodeId,
      dragOverNodeId,
      onSelectNode,
      onToggleExpanded,
      onToggleStarred,
      handleStartEdit,
      handleDeleteNode,
      handleFinishEdit,
      handleCancelEdit,
      handleDragStart,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handleDragEnd,
      t
    ]
  )

  return (
    <SidebarContainer>
      <SidebarHeader>
        <HeaderActions>
          <Tooltip title={t('notes.new_folder')} mouseEnterDelay={0.8}>
            <ActionButton onClick={handleCreateFolder}>
              <FolderPlus size={18} />
            </ActionButton>
          </Tooltip>

          <Tooltip title={t('notes.new_note')} mouseEnterDelay={0.8}>
            <ActionButton onClick={handleCreateNote}>
              <FilePlus size={18} />
            </ActionButton>
          </Tooltip>
        </HeaderActions>
      </SidebarHeader>

      <NotesTreeContainer>
        <StyledScrollbar>
          <TreeContent>{notesTree.map((node) => renderTreeNode(node))}</TreeContent>
        </StyledScrollbar>
      </NotesTreeContainer>
    </SidebarContainer>
  )
}

const SidebarContainer = styled.div`
  width: 280px;
  height: 100vh;
  background-color: var(--color-background);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
`

const SidebarHeader = styled.div`
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
`

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const NotesTreeContainer = styled.div`
  flex: 1;
  overflow: hidden;
`

const StyledScrollbar = styled(Scrollbar)`
  height: 100%;
`

const TreeContent = styled.div`
  padding: 8px;
`

const TreeNodeContainer = styled.div<{ active: boolean; depth: number; isDragging?: boolean; isDragOver?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  margin-bottom: 2px;
  background-color: ${(props) => {
    if (props.isDragOver) return 'var(--color-primary-background)'
    if (props.active) return 'var(--color-background-soft)'
    return 'transparent'
  }};
  border: 1px solid
    ${(props) => {
      if (props.isDragOver) return 'var(--color-primary)'
      if (props.active) return 'var(--color-border)'
      return 'transparent'
    }};
  opacity: ${(props) => (props.isDragging ? 0.5 : 1)};
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--color-background-soft);

    .node-actions {
      opacity: 1;
    }
  }
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
`

const StarIcon = styled.div`
  display: flex;
  align-items: center;
  margin-left: 4px;
  color: var(--color-primary);
`

const EditInput = styled(Input)`
  flex: 1;
  font-size: 13px;

  .ant-input {
    font-size: 13px;
    padding: 2px 6px;
    border: 1px solid var(--color-primary);
  }
`

const NodeActions = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.2s ease;
`

const ActionButton = styled.div`
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  color: var(--color-text-2);
  cursor: pointer;

  &:hover {
    background-color: var(--color-background-soft);
    color: var(--color-text);
  }
`

export default NotesSidebar
