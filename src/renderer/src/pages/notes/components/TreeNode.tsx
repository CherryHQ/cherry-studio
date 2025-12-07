import HighlightText from '@renderer/components/HighlightText'
import {
  useNotesActions,
  useNotesDrag,
  useNotesEditing,
  useNotesSearch,
  useNotesSelection,
  useNotesUI
} from '@renderer/pages/notes/context/NotesContexts'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { SearchMatch, SearchResult } from '@renderer/services/NotesSearchService'
import type { NotesTreeNode } from '@renderer/types/note'
import { Dropdown } from 'antd'
import { ChevronDown, ChevronRight, File, FilePlus, Folder, FolderOpen } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface TreeNodeProps {
  node: NotesTreeNode | SearchResult
  depth: number
  renderChildren?: boolean
  onHintClick?: () => void
}

const TreeNode = memo<TreeNodeProps>(({ node, depth, renderChildren = true, onHintClick }) => {
  const { t } = useTranslation()

  // Use split contexts - only subscribe to what this node needs
  const { selectedFolderId, activeNodeId } = useNotesSelection()
  const { editingNodeId, renamingNodeIds, newlyRenamedNodeIds, inPlaceEdit } = useNotesEditing()
  const { draggedNodeId, dragOverNodeId, dragPosition, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } =
    useNotesDrag()
  const { searchKeyword, showMatches } = useNotesSearch()
  const { openDropdownKey } = useNotesUI()
  const { getMenuItems, onSelectNode, onToggleExpanded, onDropdownOpenChange } = useNotesActions()

  const [showAllMatches, setShowAllMatches] = useState(false)
  const { isEditing: isInputEditing, inputProps } = inPlaceEdit

  // 检查是否是 hint 节点
  const isHintNode = node.type === 'hint'

  // 检查是否是搜索结果
  const searchResult = 'matchType' in node ? (node as SearchResult) : null
  const hasMatches = searchResult && searchResult.matches && searchResult.matches.length > 0

  // 处理匹配项点击
  const handleMatchClick = useCallback(
    (match: SearchMatch) => {
      // 发送定位事件
      EventEmitter.emit(EVENT_NAMES.LOCATE_NOTE_LINE, {
        noteId: node.id,
        lineNumber: match.lineNumber,
        lineContent: match.lineContent
      })
    },
    [node]
  )

  const isActive = selectedFolderId ? node.type === 'folder' && node.id === selectedFolderId : node.id === activeNodeId
  const isEditing = editingNodeId === node.id && isInputEditing
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

  const displayName = useMemo(() => {
    if (!searchKeyword) {
      return node.name
    }

    const name = node.name ?? ''
    if (!name) {
      return name
    }

    const keyword = searchKeyword
    const nameLower = name.toLowerCase()
    const keywordLower = keyword.toLowerCase()
    const matchStart = nameLower.indexOf(keywordLower)

    if (matchStart === -1) {
      return name
    }

    const matchEnd = matchStart + keyword.length
    const beforeMatch = Math.min(2, matchStart)
    const contextStart = matchStart - beforeMatch
    const contextLength = 50
    const contextEnd = Math.min(name.length, matchEnd + contextLength)

    const prefix = contextStart > 0 ? '...' : ''
    const suffix = contextEnd < name.length ? '...' : ''

    return prefix + name.substring(contextStart, contextEnd) + suffix
  }, [node.name, searchKeyword])

  // Special render for hint nodes
  if (isHintNode) {
    return (
      <div key={node.id}>
        <TreeNodeContainer active={false} depth={depth}>
          <TreeNodeContent>
            <NodeIcon>
              <FilePlus size={16} />
            </NodeIcon>
            <DropHintText onClick={onHintClick}>{t('notes.drop_markdown_hint')}</DropHintText>
          </TreeNodeContent>
        </TreeNodeContainer>
      </div>
    )
  }

  return (
    <div key={node.id}>
      <Dropdown
        menu={{ items: getMenuItems(node as NotesTreeNode) }}
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
            onDragStart={(e) => onDragStart(e, node as NotesTreeNode)}
            onDragOver={(e) => onDragOver(e, node as NotesTreeNode)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, node as NotesTreeNode)}
            onDragEnd={onDragEnd}>
            <TreeNodeContent onClick={() => onSelectNode(node as NotesTreeNode)}>
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
                <EditInput {...inputProps} onClick={(e) => e.stopPropagation()} autoFocus />
              ) : (
                <NodeNameContainer>
                  <NodeName className={getNodeNameClassName()}>
                    {searchKeyword ? <HighlightText text={displayName} keyword={searchKeyword} /> : node.name}
                  </NodeName>
                  {searchResult && searchResult.matchType && searchResult.matchType !== 'filename' && (
                    <MatchBadge matchType={searchResult.matchType}>
                      {searchResult.matchType === 'both' ? t('notes.search.both') : t('notes.search.content')}
                    </MatchBadge>
                  )}
                </NodeNameContainer>
              )}
            </TreeNodeContent>
          </TreeNodeContainer>
        </div>
      </Dropdown>

      {showMatches && hasMatches && (
        <SearchMatchesContainer depth={depth}>
          {(showAllMatches ? searchResult!.matches! : searchResult!.matches!.slice(0, 3)).map((match, idx) => (
            <MatchItem key={idx} onClick={() => handleMatchClick(match)}>
              <MatchLineNumber>{match.lineNumber}</MatchLineNumber>
              <MatchContext>
                <HighlightText text={match.context} keyword={searchKeyword} />
              </MatchContext>
            </MatchItem>
          ))}
          {searchResult!.matches!.length > 3 && (
            <MoreMatches
              depth={depth}
              onClick={(e) => {
                e.stopPropagation()
                setShowAllMatches(!showAllMatches)
              }}>
              {showAllMatches ? (
                <>
                  <ChevronDown size={12} style={{ marginRight: 4 }} />
                  {t('notes.search.show_less')}
                </>
              ) : (
                <>
                  <ChevronRight size={12} style={{ marginRight: 4 }} />+{searchResult!.matches!.length - 3}{' '}
                  {t('notes.search.more_matches')}
                </>
              )}
            </MoreMatches>
          )}
        </SearchMatchesContainer>
      )}

      {renderChildren && node.type === 'folder' && node.expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} renderChildren={renderChildren} />
          ))}
        </div>
      )}
    </div>
  )
})

export const TreeNodeContainer = styled.div<{
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
  /* CRITICAL: Must have fully opaque background for sticky to work properly */
  /* Transparent/semi-transparent backgrounds will show content bleeding through when sticky */
  background-color: ${(props) => {
    if (props.isDragInside) return 'var(--color-primary-background)'
    // Use hover color for active state - it's guaranteed to be opaque
    if (props.active) return 'var(--color-hover, var(--color-background-mute))'
    return 'var(--color-background)'
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

export const TreeNodeContent = styled.div`
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
`

export const NodeIndent = styled.div<{ depth: number }>`
  width: ${(props) => props.depth * 16}px;
  flex-shrink: 0;
`

export const ExpandIcon = styled.div`
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

export const NodeIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
  color: var(--color-text-2);
  flex-shrink: 0;
`

export const NodeName = styled.div`
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

export const SearchMatchesContainer = styled.div<{ depth: number }>`
  margin-left: ${(props) => props.depth * 16 + 40}px;
  margin-top: 4px;
  margin-bottom: 8px;
  padding: 6px 8px;
  background-color: var(--color-background-mute);
  border-radius: 4px;
  border-left: 2px solid var(--color-primary-soft);
`

export const NodeNameContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
`

export const MatchBadge = styled.span<{ matchType: string }>`
  display: inline-flex;
  align-items: center;
  padding: 0 4px;
  height: 16px;
  font-size: 10px;
  line-height: 1;
  border-radius: 2px;
  background-color: ${(props) =>
    props.matchType === 'both' ? 'var(--color-primary-soft)' : 'var(--color-background-mute)'};
  color: ${(props) => (props.matchType === 'both' ? 'var(--color-primary)' : 'var(--color-text-3)')};
  font-weight: 500;
  flex-shrink: 0;
`

export const MatchItem = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
  padding: 4px 6px;
  margin-left: -6px;
  margin-right: -6px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background-color: var(--color-background-soft);
    transform: translateX(2px);
  }

  &:active {
    background-color: var(--color-active);
  }

  &:last-child {
    margin-bottom: 0;
  }
`

export const MatchLineNumber = styled.span`
  color: var(--color-text-3);
  font-family: monospace;
  flex-shrink: 0;
  width: 30px;
`

export const MatchContext = styled.div`
  color: var(--color-text-2);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
`

export const MoreMatches = styled.div<{ depth: number }>`
  margin-top: 4px;
  padding: 4px 6px;
  margin-left: -6px;
  margin-right: -6px;
  font-size: 11px;
  color: var(--color-text-3);
  border-radius: 3px;
  cursor: pointer;
  display: flex;
  align-items: center;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-2);
    background-color: var(--color-background-soft);
  }
`

const EditInput = styled.input`
  flex: 1;
  font-size: 13px;
`

const DropHintText = styled.div`
  color: var(--color-text-3);
  font-size: 12px;
  font-style: italic;
`

export default TreeNode
