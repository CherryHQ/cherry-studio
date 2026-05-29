import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  Item,
  ItemContent,
  ItemMedia
} from '@cherrystudio/ui'
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

  const isHintNode = node.type === 'hint'
  const searchResult = 'matchType' in node ? node : null
  const hasMatches = searchResult && searchResult.matches && searchResult.matches.length > 0

  const handleMatchClick = useCallback(
    (match: SearchMatch) => {
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

  if (isHintNode) {
    return (
      <div key={node.id}>
        <Item
          role="button"
          tabIndex={0}
          size="sm"
          onClick={onHintClick}
          className="relative min-h-12 flex-nowrap justify-between gap-0 rounded-md border border-border-muted border-dashed px-3 py-2 text-foreground-muted transition-colors hover:border-border-hover hover:bg-muted/30 hover:text-foreground">
          <div style={{ width: depth * 16 }} className="flex-shrink-0" />
          <ItemMedia className="mr-3 text-current">
            <FilePlus size={16} />
          </ItemMedia>
          <ItemContent className="min-w-0 flex-row items-center gap-0">
            <span className="text-xs italic">{t('notes.drop_markdown_hint')}</span>
          </ItemContent>
        </Item>
      </div>
    )
  }

  return (
    <div key={node.id}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div onContextMenu={(e) => e.stopPropagation()}>
            <Item
              role="treeitem"
              aria-selected={isActive || undefined}
              variant={isDragInside || isActive ? 'muted' : 'default'}
              size="sm"
              className={cn(
                'relative h-8 cursor-pointer flex-nowrap justify-between gap-0 rounded-[10px] border-[0.5px] px-3 py-0 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                node.type === 'folder' ? 'text-foreground' : 'text-sidebar-foreground/75',
                isDragInside
                  ? 'border-sidebar-ring bg-sidebar-accent text-sidebar-foreground'
                  : isActive
                    ? 'border-transparent bg-secondary text-foreground'
                    : 'border-transparent',
                isDragging && 'opacity-50',
                isDragBefore &&
                  'before:-top-0.5 before:absolute before:right-0 before:left-0 before:h-0.5 before:rounded-[1px] before:bg-sidebar-ring before:content-[""]',
                isDragAfter &&
                  'after:-bottom-0.5 after:absolute after:right-0 after:left-0 after:h-0.5 after:rounded-[1px] after:bg-sidebar-ring after:content-[""]'
              )}
              draggable={!isEditing}
              data-node-id={node.id}
              onClick={() => {
                if (!isEditing) {
                  onSelectNode(node as NotesTreeNode)
                }
              }}
              onDragStart={(e) => onDragStart(e, node as NotesTreeNode)}
              onDragOver={(e) => onDragOver(e, node as NotesTreeNode)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, node as NotesTreeNode)}
              onDragEnd={onDragEnd}>
              <div className="flex min-w-0 flex-1 items-center">
                <div style={{ width: depth * 16 }} className="flex-shrink-0" />

                {node.type === 'folder' && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="mr-1 size-4 rounded-sm p-0 text-current shadow-none hover:bg-transparent hover:text-current"
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleExpanded(node.id)
                    }}
                    aria-label={node.expanded ? t('notes.collapse') : t('notes.expand')}
                    title={node.expanded ? t('notes.collapse') : t('notes.expand')}>
                    {node.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </Button>
                )}

                <ItemMedia className="mr-3 text-current">
                  {node.type === 'folder' ? (
                    node.expanded ? (
                      <FolderOpen size={16} />
                    ) : (
                      <Folder size={16} />
                    )
                  ) : (
                    <File size={16} />
                  )}
                </ItemMedia>

                {isEditing ? (
                  <input
                    {...inputProps}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    className="flex-1 bg-transparent text-foreground text-sm outline-none"
                  />
                ) : (
                  <ItemContent className="min-w-0 flex-row items-center gap-1.5">
                    <div
                      className={cn(
                        'relative flex-1 truncate text-sm will-change-[background-position,width]',
                        isActive && 'font-medium',
                        getNodeNameClassName()
                      )}>
                      {searchKeyword ? <HighlightText text={displayName} keyword={searchKeyword} /> : node.name}
                    </div>
                    {searchResult && searchResult.matchType && searchResult.matchType !== 'filename' && (
                      <span
                        className={cn(
                          'inline-flex h-4 flex-shrink-0 items-center rounded-sm px-1 font-medium text-[10px] leading-none',
                          searchResult.matchType === 'both'
                            ? 'bg-info-bg text-info-base'
                            : 'bg-secondary text-foreground-muted'
                        )}>
                        {searchResult.matchType === 'both' ? t('notes.search.both') : t('notes.search.content')}
                      </span>
                    )}
                  </ItemContent>
                )}
              </div>
            </Item>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>{renderMenuItems(node as NotesTreeNode)}</ContextMenuContent>
      </ContextMenu>

      {showMatches && hasMatches && (
        <div
          style={{ marginLeft: depth * 16 + 40 }}
          className="mt-1 mb-2 rounded-sm border-info-base border-l-2 bg-info-bg px-2 py-1.5">
          {(showAllMatches ? searchResult.matches! : searchResult.matches!.slice(0, 3)).map((match, idx) => (
            <div
              key={idx}
              onClick={() => handleMatchClick(match)}
              className="-mx-1.5 mb-1 flex cursor-pointer gap-2 rounded-sm px-1.5 py-1 font-mono text-xs transition-all duration-150 last:mb-0 hover:translate-x-0.5 hover:bg-background active:bg-accent">
              <span className="w-7.5 flex-shrink-0 font-mono text-foreground-muted">{match.lineNumber}</span>
              <div className="flex-1 truncate font-mono text-foreground-secondary">
                <HighlightText text={match.context} keyword={searchKeyword} />
              </div>
            </div>
          ))}
          {searchResult.matches!.length > 3 && (
            <div
              onClick={(e) => {
                e.stopPropagation()
                setShowAllMatches(!showAllMatches)
              }}
              className="-mx-1.5 mt-1 flex cursor-pointer items-center rounded-sm px-1.5 py-1 text-foreground-muted text-xs transition-all duration-150 hover:bg-background hover:text-foreground-secondary">
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

TreeNode.displayName = 'TreeNode'

export default TreeNode
