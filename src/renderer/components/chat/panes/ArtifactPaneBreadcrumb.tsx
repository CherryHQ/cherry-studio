import { Fragment, useState } from 'react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { CommandContextMenu, type CommandContextMenuExtraItem, type MaybePromise } from '@renderer/components/command'
import { FileTree, type FileTreeNode } from '@renderer/components/FileTree'

interface ArtifactPaneBreadcrumbProps {
  /** Workspace-relative path of the open file, or null for files outside the workspace. */
  relativePath: string | null
  fallbackTitle: string
  fullPath: string
  rootEntries: FileTreeNode[]
  nodeById: ReadonlyMap<string, FileTreeNode>
  onOpenFile: (id: string) => void
  /** Loads a folder's entries without expanding it in the tree. */
  onLoadFolder: (id: string) => void
  /** Right-click menu of the file segment (or the whole breadcrumb outside the workspace). */
  fileMenuItems: readonly CommandContextMenuExtraItem[]
  /** Right-click menu of a folder segment. */
  getFolderMenuItems: (id: string) => MaybePromise<readonly CommandContextMenuExtraItem[]>
}

export function ArtifactPaneBreadcrumb({
  relativePath,
  fallbackTitle,
  fullPath,
  rootEntries,
  nodeById,
  onOpenFile,
  onLoadFolder,
  fileMenuItems,
  getFolderMenuItems
}: ArtifactPaneBreadcrumbProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  if (!relativePath) {
    return (
      <Breadcrumb className="min-w-0" title={fullPath}>
        <BreadcrumbList className="flex-nowrap">
          <CommandContextMenu location="webcontents.context" extraItems={fileMenuItems}>
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate px-1">{fallbackTitle}</BreadcrumbPage>
            </BreadcrumbItem>
          </CommandContextMenu>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  const segments = relativePath.split('/')
  return (
    <Breadcrumb className="min-w-0" title={fullPath}>
      <BreadcrumbList className="flex-nowrap gap-0.5 sm:gap-0.5">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1
          // A folder segment lists its own entries; the file segment lists its siblings.
          const folderId = segments.slice(0, isLast ? index : index + 1).join('/')
          return (
            <Fragment key={index}>
              <BreadcrumbItem className="min-w-0 shrink">
                <Popover
                  open={openIndex === index}
                  onOpenChange={(open) => {
                    setOpenIndex(open ? index : null)
                    if (open && folderId) onLoadFolder(folderId)
                  }}>
                  <CommandContextMenu
                    location="webcontents.context"
                    {...(isLast
                      ? { extraItems: fileMenuItems }
                      : { getExtraItems: () => getFolderMenuItems(segments.slice(0, index + 1).join('/')) })}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'truncate rounded px-1 transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
                          isLast && 'text-foreground'
                        )}>
                        {segment}
                      </button>
                    </PopoverTrigger>
                  </CommandContextMenu>
                  <PopoverContent className="max-h-80 w-64 overflow-y-auto p-1" align="start">
                    <FolderTree
                      entries={folderId ? (nodeById.get(folderId)?.children ?? []) : rootEntries}
                      selectedId={relativePath}
                      nodeById={nodeById}
                      onOpenFile={(id) => {
                        setOpenIndex(null)
                        onOpenFile(id)
                      }}
                      onLoadFolder={onLoadFolder}
                    />
                  </PopoverContent>
                </Popover>
              </BreadcrumbItem>
              {isLast ? null : <BreadcrumbSeparator />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function FolderTree({
  entries,
  selectedId,
  nodeById,
  onOpenFile,
  onLoadFolder
}: {
  entries: FileTreeNode[]
  selectedId: string
  nodeById: ReadonlyMap<string, FileTreeNode>
  onOpenFile: (id: string) => void
  onLoadFolder: (id: string) => void
}) {
  // Local to the popover so expanding here never changes the pane's tree.
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  return (
    <FileTree
      nodes={entries}
      expandedIds={expandedIds}
      onExpandedChange={(next) => {
        for (const id of next) if (!expandedIds.has(id)) onLoadFolder(id)
        setExpandedIds(next)
      }}
      selectedId={selectedId}
      onSelectedChange={(id) => id && nodeById.get(id)?.kind === 'file' && onOpenFile(id)}
      showFolderIcons={false}
      // ponytail: unvirtualized, one folder's entries fit; virtualize if huge folders lag
      renderList={({ flat, renderItem }) =>
        flat.map((item, index) => <Fragment key={item.id}>{renderItem(index)}</Fragment>)
      }
    />
  )
}
