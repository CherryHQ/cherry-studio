import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@cherrystudio/ui'
import { FolderClosed, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { FileItem } from './fileDisplay'

export interface FileContextMenuActions {
  onRename: (id: string) => void
  onDelete: (id: string) => void
  onShowInFolder: (id: string) => void
}

/**
 * Per-file right-click menu. Wraps a file row/card trigger and renders rename,
 * show-in-folder, and delete branched on internal vs. external origin.
 *
 * Built on the @cherrystudio/ui ContextMenu primitive (Radix), which provides
 * cursor positioning, click-outside/Escape dismiss, viewport collision, keyboard
 * navigation, and focus management.
 */
export function FileContextMenu({
  file,
  actions,
  children,
  showRename = true,
  deleteDisabled = false
}: {
  file: FileItem
  actions: FileContextMenuActions
  children: React.ReactNode
  showRename?: boolean
  deleteDisabled?: boolean
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <FileContextMenuContent file={file} actions={actions} showRename={showRename} deleteDisabled={deleteDisabled} />
    </ContextMenu>
  )
}

function FileContextMenuContent({
  file,
  actions,
  showRename,
  deleteDisabled
}: {
  file: FileItem
  actions: FileContextMenuActions
  showRename: boolean
  deleteDisabled: boolean
}) {
  const { t } = useTranslation()
  const canUseFileActions = !file.isMissing
  const canRename = canUseFileActions && showRename
  const canShowInFolder = canUseFileActions
  const hasPrimaryAction = canRename || canShowInFolder

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
      <ContextMenuItem disabled={deleteDisabled} variant="destructive" onSelect={() => actions.onDelete(file.id)}>
        <ContextMenuItemContent icon={<Trash2 size={12} />}>
          {file.origin === 'external' ? t('files.remove_from_library') : t('files.delete.label')}
        </ContextMenuItemContent>
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
