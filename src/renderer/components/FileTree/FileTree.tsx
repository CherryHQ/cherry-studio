import {
  Button,
  type FlatTreeItem,
  Input,
  type RenderRowFn,
  type TreeListSlotArgs,
  type TreeNodeAdapter,
  TreeView
} from '@cherrystudio/ui'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { Search, X } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { FileTreeRow } from './FileTreeRow'
import type { FileTreeNode, FileTreeProps } from './types'

const DEFAULT_ITEM_SIZE = 28
const VIRTUAL_OVERSCAN = 10

/**
 * File-tree component built on top of TreeView.
 *
 * Two interaction modes are achieved purely by which props you pass:
 * - Editable: pass `onMove`, `renameSlot`, and `renderRowExtras` (for menus/buttons).
 * - Read-only: omit those props. The same component renders with drag disabled,
 *   rename disabled, and no trailing slot.
 *
 * The sticky-folder behaviour requires the surrounding scroll container to set
 * `isolation: isolate` to keep sticky headers under sibling UI like a global navbar.
 */
export function FileTree(props: FileTreeProps) {
  const {
    nodes,
    expandedIds,
    defaultExpandedIds,
    onExpandedChange,
    selectedId,
    defaultSelectedId,
    onSelectedChange,
    onMove,
    renameSlot,
    animationSlot,
    renderRowExtras,
    getMenuItems,
    fileIcon,
    folderIcon,
    renderList,
    stickyFolders = true,
    showSearch = false,
    searchKeyword = '',
    onSearchKeywordChange,
    searchPlaceholder,
    searchToolbar,
    searchClearLabel,
    emptyState
  } = props

  const adapter = useMemo<TreeNodeAdapter<FileTreeNode>>(
    () => ({
      getId: (n) => n.id,
      getChildren: (n) => n.children,
      canHaveChildren: (n) => n.kind === 'folder',
      isSticky: stickyFolders ? (n) => n.kind === 'folder' : undefined
    }),
    [stickyFolders]
  )

  const renderRow: RenderRowFn<FileTreeNode> = useCallback(
    (args) => (
      <FileTreeRow
        args={args}
        renameSlot={renameSlot}
        animationSlot={animationSlot}
        renderRowExtras={renderRowExtras}
        getMenuItems={getMenuItems}
        fileIcon={fileIcon}
        folderIcon={folderIcon}
      />
    ),
    [renameSlot, animationSlot, renderRowExtras, getMenuItems, fileIcon, folderIcon]
  )

  const defaultRenderList = useCallback(
    ({ flat, isSticky, getItemDepth, renderItem }: TreeListSlotArgs<FileTreeNode>) => (
      <DynamicVirtualList
        list={flat as FlatTreeItem<FileTreeNode>[]}
        estimateSize={() => DEFAULT_ITEM_SIZE}
        overscan={VIRTUAL_OVERSCAN}
        isSticky={isSticky}
        getItemDepth={getItemDepth}>
        {(_item, index) => renderItem(index)}
      </DynamicVirtualList>
    ),
    []
  )

  const tree = (
    <TreeView<FileTreeNode>
      data={nodes}
      adapter={adapter}
      expandedIds={expandedIds}
      defaultExpandedIds={defaultExpandedIds}
      onExpandedChange={onExpandedChange}
      selectedId={selectedId}
      defaultSelectedId={defaultSelectedId}
      onSelectedChange={onSelectedChange}
      onMove={onMove}
      renderRow={renderRow}
      renderList={renderList ?? defaultRenderList}
      emptyState={emptyState}
    />
  )

  if (!showSearch) {
    return tree
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-2 py-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={14}
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 text-muted-foreground"
          />
          <Input
            type="text"
            value={searchKeyword}
            onChange={(e) => onSearchKeywordChange?.(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 min-w-0 flex-1 pr-7 pl-7 text-sm"
            data-testid="file-tree-search-input"
          />
          {searchKeyword && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={searchClearLabel ?? 'Clear search'}
              onClick={() => onSearchKeywordChange?.('')}
              className="-translate-y-1/2 absolute top-1/2 right-1 size-5 min-h-5 text-foreground-muted hover:bg-accent hover:text-foreground">
              <X className="size-[13px]" />
            </Button>
          )}
        </div>
        {searchToolbar}
      </div>
      <div className="min-h-0 flex-1">{tree}</div>
    </div>
  )
}
