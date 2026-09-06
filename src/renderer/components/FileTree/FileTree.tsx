// Side effect: defines <file-tree-container>, whose connectedCallback attaches
// the shadow root and adopts the core stylesheet. Without it nothing renders.
import '@pierre/trees/web-components'

import { FileTree as TreesFileTree, useFileTreeSelector } from '@pierre/trees/react'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { cn } from '@renderer/utils/style'
import type { ReactNode } from 'react'
import { useCallback } from 'react'

import type { FileTreeModel } from './fileTreeModel'
import { FILE_TREE_THEME_STYLE } from './treeTheme'

const EMPTY_MENU_ITEMS: readonly CommandContextMenuExtraItem[] = []

export interface FileTreeProps {
  /** Caller-owned model — see `createFileTreeModel` for why it is not a hook. */
  model: FileTreeModel
  /** Right-click items. `path` is null when the click landed outside every row. */
  getMenuItems?: (path: string | null) => readonly CommandContextMenuExtraItem[]
  /** Rendered over the tree while it has no visible rows. */
  emptyState?: ReactNode
  className?: string
}

/**
 * Resolves the row a right-click landed on.
 *
 * Rows live in the tree's shadow root, so the event is retargeted to the host by
 * the time React sees it — `composedPath()` is the only way back to the real row.
 * Each row carries its canonical path as `data-item-path`.
 */
function resolveContextMenuPath(event: React.MouseEvent): string | null {
  for (const target of event.nativeEvent.composedPath()) {
    if (!(target instanceof HTMLElement)) continue
    const path = target.dataset.itemPath
    if (path != null) return path
  }
  return null
}

/**
 * File tree for the agent artifact pane and the notes sidebar.
 *
 * Rows are rendered by `@pierre/trees` inside a shadow root, so this component
 * owns only what has to stay on our side: the design-token bridge and the
 * command-system context menu. See `README.md` for the constraints that shape it.
 */
export function FileTree({ model, getMenuItems, emptyState, className }: FileTreeProps) {
  const visibleCount = useFileTreeSelector(model, (current) => current.getVisibleCount())

  // The library's own context menu stays off: `renderContextMenu` puts a React
  // node in a shadow slot, which would pin us to the Radix presentation and lose
  // the native Electron menu that `webcontents.context` resolves to.
  const resolveExtraItems = useCallback(
    (event: React.MouseEvent) => getMenuItems?.(resolveContextMenuPath(event)) ?? EMPTY_MENU_ITEMS,
    [getMenuItems]
  )

  return (
    <CommandContextMenu location="webcontents.context" getExtraItems={resolveExtraItems}>
      <div className={cn('relative h-full min-h-0', className)}>
        <TreesFileTree model={model} style={FILE_TREE_THEME_STYLE} className="block h-full min-h-0" />
        {visibleCount === 0 && emptyState ? <div className="absolute inset-0">{emptyState}</div> : null}
      </div>
    </CommandContextMenu>
  )
}
