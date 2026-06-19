import { Button, type RenderRowArgs } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Icon } from '@iconify/react'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { getFileIconName } from '@renderer/utils/fileIconName'
import { ChevronRight } from 'lucide-react'
import type React from 'react'

import type { FileTreeAnimationSlot, FileTreeNode, FileTreeRenameSlot } from './types'

interface FileTreeRowProps {
  args: RenderRowArgs<FileTreeNode>
  renameSlot?: FileTreeRenameSlot
  animationSlot?: FileTreeAnimationSlot
  renderRowExtras?: (node: FileTreeNode) => React.ReactNode
  getMenuItems?: (node: FileTreeNode) => readonly CommandContextMenuExtraItem[]
  fileIcon?: (node: FileTreeNode) => React.ReactNode
  folderIcon?: (node: FileTreeNode, expanded: boolean) => React.ReactNode
}

const INDENT_STEP_PX = 12
const INDENT_BASE_PX = 8
const ICON_SIZE_PX = 16
const CHEVRON_SIZE_PX = 11
const MATERIAL_ICON_PREFIX = 'material-icon-theme:'

export function FileTreeRow(props: FileTreeRowProps) {
  const { args, renameSlot, animationSlot, renderRowExtras, getMenuItems, fileIcon, folderIcon } = props
  const { node, depth, isExpanded, isSelected, isDragging, dragPosition, toggleExpanded, selectNode, dragHandleProps } =
    args

  const isFolder = node.kind === 'folder'
  const isRenaming = renameSlot ? renameSlot.isRenaming(node) : false
  const effectiveDragHandleProps = isRenaming ? { ...dragHandleProps, draggable: false } : dragHandleProps

  const nameAnimationClassName = animationSlot
    ? animationSlot.isAnimating(node)
      ? 'animation-shimmer'
      : animationSlot.isNewlyRenamed(node)
        ? 'animation-reveal'
        : ''
    : ''

  const renderIcon = () => {
    if (isFolder) {
      return folderIcon ? (
        folderIcon(node, isExpanded)
      ) : (
        <Icon
          icon={`${MATERIAL_ICON_PREFIX}${isExpanded ? 'folder-open' : 'folder'}`}
          className="shrink-0"
          width={ICON_SIZE_PX}
          height={ICON_SIZE_PX}
        />
      )
    }
    return fileIcon ? (
      fileIcon(node)
    ) : (
      <Icon
        icon={`${MATERIAL_ICON_PREFIX}${getFileIconName(node.name)}`}
        className="shrink-0"
        width={ICON_SIZE_PX}
        height={ICON_SIZE_PX}
      />
    )
  }

  const handleRowClick = () => {
    selectNode()
    if (isFolder) toggleExpanded()
  }

  const indent = { paddingLeft: `${depth * INDENT_STEP_PX + INDENT_BASE_PX}px` }

  const row = (
    <div
      {...effectiveDragHandleProps}
      data-node-id={node.id}
      data-kind={node.kind}
      onClick={handleRowClick}
      onContextMenu={(e) => e.stopPropagation()}
      title={node.name}
      style={indent}
      className={cn(
        'group relative flex select-none items-center gap-1.5 rounded-3xs py-1 pr-2 text-left text-sm',
        'transition-colors',
        isFolder
          ? 'text-foreground/75 hover:bg-accent/50 hover:text-foreground'
          : 'text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground',
        isSelected && 'bg-accent/60 text-foreground',
        isDragging && 'opacity-50',
        dragPosition === 'inside' && 'bg-primary/15 ring-1 ring-primary/40',
        dragPosition === 'before' &&
          "before:-top-px before:absolute before:inset-x-1 before:h-0.5 before:rounded before:bg-primary before:content-['']",
        dragPosition === 'after' &&
          "after:-bottom-px after:absolute after:inset-x-1 after:h-0.5 after:rounded after:bg-primary after:content-['']"
      )}>
      {isFolder ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation()
            toggleExpanded()
          }}
          className="size-auto min-h-0 shrink-0 rounded-none p-0 text-muted-foreground/50 shadow-none hover:bg-transparent hover:text-muted-foreground"
          tabIndex={-1}
          aria-hidden>
          <ChevronRight
            size={CHEVRON_SIZE_PX}
            className="shrink-0 transition-transform"
            style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}
          />
        </Button>
      ) : (
        <span className="inline-block size-3 shrink-0" aria-hidden="true" />
      )}

      {renderIcon()}

      {isRenaming && renameSlot ? (
        <input
          {...renameSlot.inputProps}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'min-w-0 flex-1 rounded border bg-background px-1 text-sm leading-4 outline-none',
            renameSlot.inputProps.className
          )}
          autoFocus
        />
      ) : (
        <span className={cn('min-w-0 flex-1 truncate', nameAnimationClassName)}>{node.name}</span>
      )}

      {renderRowExtras ? (
        <span onClick={(e) => e.stopPropagation()} className="shrink-0">
          {renderRowExtras(node)}
        </span>
      ) : null}
    </div>
  )

  const menuItems = getMenuItems?.(node)
  if (!menuItems || menuItems.length === 0) {
    return row
  }

  return (
    <CommandContextMenu location="webcontents.context" extraItems={menuItems}>
      {row}
    </CommandContextMenu>
  )
}
