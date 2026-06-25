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
 *
 * `onOpen` lets the owner select the right-clicked item when needed; callers can
 * leave existing multi-selection untouched when the item is already selected.
 */
export function FileContextMenu({
  file,
  isTrash,
  onOpen,
  actions,
  children
}: {
  file: FileItem
  isTrash: boolean
  onOpen: (id: string) => void
  actions: FileContextMenuActions
  children: React.ReactNode
}) {
  return (
    <ContextMenu onOpenChange={(open) => open && onOpen(file.id)}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <FileContextMenuContent file={file} isTrash={isTrash} actions={actions} />
    </ContextMenu>
  )
}

function FileContextMenuContent({
  file,
  isTrash,
  actions
}: {
  file: FileItem
  isTrash: boolean
  actions: FileContextMenuActions
}) {
  const { t } = useTranslation()

  if (isTrash) {
    return (
      <ContextMenuContent className="min-w-32">
        <ContextMenuItem onSelect={() => actions.onRestore(file.id)}>
          <ContextMenuItemContent icon={<RotateCcw size={12} />}>{t('files.restore')}</ContextMenuItemContent>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => actions.onDelete(file.id)}>
          <ContextMenuItemContent icon={<Trash2 size={12} />}>{t('files.permanent_delete')}</ContextMenuItemContent>
        </ContextMenuItem>
      </ContextMenuContent>
    )
  }

  return (
    <ContextMenuContent className="min-w-32">
      <ContextMenuItem onSelect={() => actions.onRename(file.id)}>
        <ContextMenuItemContent icon={<Pencil size={12} />}>{t('files.rename')}</ContextMenuItemContent>
      </ContextMenuItem>
      {file.origin === 'external' && (
        <ContextMenuItem onSelect={() => actions.onShowInFolder(file.id)}>
          <ContextMenuItemContent icon={<FolderClosed size={12} />}>{t('files.show_in_folder')}</ContextMenuItemContent>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => actions.onDelete(file.id)}>
        <ContextMenuItemContent icon={<Trash2 size={12} />}>
          {file.origin === 'external' ? t('files.remove_from_library') : t('files.delete.label')}
        </ContextMenuItemContent>
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
