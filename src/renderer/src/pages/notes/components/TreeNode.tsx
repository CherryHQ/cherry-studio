import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import HighlightText from '@renderer/components/HighlightText'
import {
  useNotesActions,
  useNotesDrag,
  useNotesEditing,
  useNotesSearch,
  useNotesSelection
} from '@renderer/pages/notes/context/NotesContexts'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { SearchMatch, SearchResult } from '@renderer/services/NotesSearchService'
import type { NotesTreeNode } from '@renderer/types/note'
import { ChevronDown, ChevronRight, File, FilePlus, Folder, FolderOpen } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const { renderMenuItems, onSelectNode, onToggleExpanded } = useNotesActions()

  const [showAllMatches, setShowAllMatches] = useState(false)
  const { isEditing: isInputEditing, inputProps } = inPlaceEdit

  // 检查是否是 hint 节点
  const isHintNode = node.type === 'hint'

  // 检查是否是搜索结果
  const searchResult = 'matchType' in node ? node : null
  const hasMatches = searchResult && searchResult.matches && searchResult.matches.length > 0

  // 处理匹配项点击
  const handleMatchClick = useCallback(
    (match: SearchMatch) => {
      // 发送定位事件
      void EventEmitter.emit(EVENT_NAMES.LOCATE_NOTE_LINE, {
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

  const nodeContainerClassName = cn(
    'relative mb-0.5 flex cursor-pointer items-center justify-between rounded-sm border px-1.5 py-1 transition-all duration-200',
    isDragInside
      ? 'border-primary bg-accent'
      : isActive
        ? 'border-border bg-muted'
        : 'border-transparent bg-transparent',
    isDragging && 'opacity-50',
    'hover:bg-muted'
  )

  const getNodeNameClassName = () => {
    if (isRenaming) return 'animation-shimmer'
    if (isNewlyRenamed) return 'animation-reveal'
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
        <div className="relative mb-0.5 flex cursor-pointer items-center justify-between rounded-sm border border-transparent bg-transparent px-1.5 py-1 transition-all duration-200 hover:bg-muted">
          <div className="flex min-w-0 flex-1 items-center">
            <div className="mr-2 flex shrink-0 items-center justify-center text-muted-foreground">
              <FilePlus size={16} />
            </div>
            <div className="text-muted-foreground text-xs italic" onClick={onHintClick}>
              {t('notes.drop_markdown_hint')}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div key={node.id}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div onContextMenu={(e) => e.stopPropagation()}>
            <div
              className={nodeContainerClassName}
              draggable={!isEditing}
              data-node-id={node.id}
              onDragStart={(e) => onDragStart(e, node as NotesTreeNode)}
              onDragOver={(e) => onDragOver(e, node as NotesTreeNode)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, node as NotesTreeNode)}
              onDragEnd={onDragEnd}>
              {isDragBefore && <div className="-top-0.5 absolute right-0 left-0 h-0.5 rounded bg-primary" />}
              {isDragAfter && <div className="-bottom-0.5 absolute right-0 left-0 h-0.5 rounded bg-primary" />}
              <div className="flex min-w-0 flex-1 items-center" onClick={() => onSelectNode(node as NotesTreeNode)}>
                <div className="shrink-0" style={{ width: depth * 16 }} />

                {node.type === 'folder' && (
                  <div
                    className="mr-1 flex size-4 items-center justify-center text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleExpanded(node.id)
                    }}
                    title={node.expanded ? t('notes.collapse') : t('notes.expand')}>
                    {node.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </div>
                )}

                <div className="mr-2 flex shrink-0 items-center justify-center text-muted-foreground">
                  {node.type === 'folder' ? (
                    node.expanded ? (
                      <FolderOpen size={16} />
                    ) : (
                      <Folder size={16} />
                    )
                  ) : (
                    <File size={16} />
                  )}
                </div>

                {isEditing ? (
                  <input className="flex-1 text-sm" {...inputProps} onClick={(e) => e.stopPropagation()} autoFocus />
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <div
                      className={cn(
                        'relative flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-foreground text-sm will-change-[background-position,width]',
                        getNodeNameClassName()
                      )}>
                      {searchKeyword ? <HighlightText text={displayName} keyword={searchKeyword} /> : node.name}
                    </div>
                    {searchResult && searchResult.matchType && searchResult.matchType !== 'filename' && (
                      <span
                        className={cn(
                          'inline-flex h-4 shrink-0 items-center rounded-xs px-1 font-medium text-xs leading-none',
                          searchResult.matchType === 'both'
                            ? 'bg-secondary text-secondary-foreground'
                            : 'bg-muted text-muted-foreground'
                        )}>
                        {searchResult.matchType === 'both' ? t('notes.search.both') : t('notes.search.content')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>{renderMenuItems(node as NotesTreeNode)}</ContextMenuContent>
      </ContextMenu>

      {showMatches && hasMatches && (
        <div
          className="mt-1 mb-2 rounded-sm border-info-base border-l-2 bg-info-bg px-2 py-1.5"
          style={{ marginLeft: depth * 16 + 40 }}>
          {(showAllMatches ? searchResult.matches! : searchResult.matches!.slice(0, 3)).map((match, idx) => (
            <div
              key={idx}
              className="-mx-1.5 mb-1 flex cursor-pointer gap-2 rounded-sm px-1.5 py-1 text-xs transition-all duration-150 last:mb-0 hover:translate-x-0.5 hover:bg-background active:bg-accent"
              onClick={() => handleMatchClick(match)}>
              <span className="w-7.5 shrink-0 font-mono text-muted-foreground">{match.lineNumber}</span>
              <div className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-muted-foreground">
                <HighlightText text={match.context} keyword={searchKeyword} />
              </div>
            </div>
          ))}
          {searchResult.matches!.length > 3 && (
            <div
              className="-mx-1.5 mt-1 flex cursor-pointer items-center rounded-sm px-1.5 py-1 text-muted-foreground text-xs transition-all duration-150 hover:bg-background hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                setShowAllMatches(!showAllMatches)
              }}>
              {showAllMatches ? (
                <>
                  <ChevronDown size={12} className="mr-1" />
                  {t('notes.search.show_less')}
                </>
              ) : (
                <>
                  <ChevronRight size={12} className="mr-1" />+{searchResult.matches!.length - 3}{' '}
                  {t('notes.search.more_matches')}
                </>
              )}
            </div>
          )}
        </div>
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

export default TreeNode
