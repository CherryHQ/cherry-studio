import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@cherrystudio/ui'
import { FolderClosed, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { FileItem } from './fileDisplay'

export interface FileContextMenuActions {
  onRename: (id: string) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onShowInFolder: (id: string) => void
}

/**
 * Per-file right-click menu. Wraps a file row/card trigger and renders the menu
 * content branched on trash vs. active and internal vs. external origin.
 *
 * Built on the @cherrystudio/ui ContextMenu primitive (Radix), which provides
 * cursor positioning, click-outside/Escape dismiss, viewport collision, keyboard
 * navigation, and focus management.
 */
export function FileContextMenu({
  file,
  isTrash,
  actions,
  children,
  showRename = true
}: {
  file: FileItem
  isTrash: boolean
  actions: FileContextMenuActions
  children: React.ReactNode
  showRename?: boolean
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <FileContextMenuContent file={file} isTrash={isTrash} actions={actions} showRename={showRename} />
    </ContextMenu>
  )
}

function FileContextMenuContent({
  file,
  isTrash,
  actions,
  showRename
}: {
  file: FileItem
  isTrash: boolean
  actions: FileContextMenuActions
  showRename: boolean
}) {
  const { t } = useTranslation()
  const canUseFileActions = !file.isMissing
  const canRename = canUseFileActions && showRename
  const canShowInFolder = canUseFileActions && file.origin === 'external'
  const hasPrimaryAction = canRename || canShowInFolder

  if (isTrash) {
    return (
      <ContextMenuContent className="min-w-32">
        {!file.isMissing && (
          <>
            <ContextMenuItem onSelect={() => actions.onRestore(file.id)}>
              <ContextMenuItemContent icon={<RotateCcw size={12} />}>{t('files.restore')}</ContextMenuItemContent>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem variant="destructive" onSelect={() => actions.onDelete(file.id)}>
          <ContextMenuItemContent icon={<Trash2 size={12} />}>{t('files.permanent_delete')}</ContextMenuItemContent>
        </ContextMenuItem>
      </ContextMenuContent>
    )
  }

  return (
    <ContextMenuContent className="min-w-32">
      {canRename && (
        <ContextMenuItem onSelect={() => actions.onRename(file.id)}>
          <ContextMenuItemContent icon={<Pencil size={12} />}>{t('files.rename')}</ContextMenuItemContent>
        </ContextMenuItem>
      )}
      {canShowInFolder && (
        <ContextMenuItem onSelect={() => actions.onShowInFolder(file.id)}>
          <ContextMenuItemContent icon={<FolderClosed size={12} />}>{t('files.show_in_folder')}</ContextMenuItemContent>
        </ContextMenuItem>
      )}
      {hasPrimaryAction && <ContextMenuSeparator />}
      <ContextMenuItem variant="destructive" onSelect={() => actions.onDelete(file.id)}>
        <ContextMenuItemContent icon={<Trash2 size={12} />}>
          {file.origin === 'external' ? t('files.remove_from_library') : t('files.delete.label')}
        </ContextMenuItemContent>
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
