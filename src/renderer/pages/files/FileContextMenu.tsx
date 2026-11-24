import { Copy, FolderClosed, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import SidebarShortcutIcon from '@renderer/components/icons/SidebarShortcutIcon'
import { toast } from '@renderer/services/toast'

import type { FileItem } from './fileDisplay'

const logger = loggerService.withContext('FileContextMenu')

export interface FileContextMenuActions {
  isSidebarPinned: (id: string) => boolean
  onRename: (id: string) => void
  onDelete: (id: string) => void
  onShowInFolder: (id: string) => void
  onToggleSidebar: (file: FileItem) => void
}

/**
 * Per-file right-click menu. Wraps a file row/card trigger and renders rename,
 * show-in-folder, copy path, and delete branched on internal vs. external origin.
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
  const { sourcePath } = file
  const hasPrimaryAction = canRename || canShowInFolder || !!sourcePath
  const sidebarPinned = actions.isSidebarPinned(file.id)
  const hasSidebarAction = !file.isMissing || sidebarPinned

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
      toast.success(t('common.copied'))
    } catch (error) {
      logger.error('Failed to copy file path', error as Error)
      toast.error(t('common.copy_failed'))
    }
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
      {sourcePath && (
        <ContextMenuItem onSelect={() => void copyPath(sourcePath)}>
          <ContextMenuItemContent icon={<Copy size={12} />}>{t('agent.preview_pane.copy_path')}</ContextMenuItemContent>
        </ContextMenuItem>
      )}
      {hasSidebarAction && (
        <ContextMenuItem onSelect={() => actions.onToggleSidebar(file)}>
          <ContextMenuItemContent icon={<SidebarShortcutIcon pinned={sidebarPinned} size={12} />}>
            {t(sidebarPinned ? 'launchpad.unpin_from_sidebar' : 'launchpad.pin_to_sidebar')}
          </ContextMenuItemContent>
        </ContextMenuItem>
      )}
      {(hasPrimaryAction || hasSidebarAction) && <ContextMenuSeparator />}
      <ContextMenuItem disabled={deleteDisabled} variant="destructive" onSelect={() => actions.onDelete(file.id)}>
        <ContextMenuItemContent icon={<Trash2 size={12} />}>
          {file.origin === 'external' ? t('files.remove_from_library') : t('files.delete.label')}
        </ContextMenuItemContent>
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
