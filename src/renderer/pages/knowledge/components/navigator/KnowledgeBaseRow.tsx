import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { MoreHorizontal } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import KnowledgeBaseIcon from '../KnowledgeBaseIcon'
import { statusDotClassNames } from '../statusStyles'
import { KnowledgeBaseRowMenu } from './NavigatorMenu'
import type { KnowledgeBaseRowProps } from './types'
import useContextMenuPosition from './useContextMenuPosition'

const KnowledgeBaseRow = ({
  base,
  groups,
  selected,
  onSelectBase,
  onMoveBase,
  onRenameBase,
  onDeleteBase
}: KnowledgeBaseRowProps) => {
  const { t } = useTranslation()
  const {
    isMenuOpen,
    contextMenuPosition,
    closeContextMenu,
    handleContextMenu,
    handleMenuOpenChange,
    handleMoreButtonClick
  } = useContextMenuPosition()
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const availableGroups = useMemo(() => groups.filter((group) => group.id !== base.groupId), [base.groupId, groups])
  const statusLabelKey = `knowledge.status.${base.status}` as const
  const statusLabel = t(statusLabelKey)

  const handleMoveBase = useCallback(
    async (groupId: string | null) => {
      closeContextMenu()

      if (base.groupId === groupId) {
        return
      }

      await onMoveBase(base.id, groupId)
    },
    [base.groupId, base.id, closeContextMenu, onMoveBase]
  )

  const handleRenameBase = useCallback(() => {
    closeContextMenu()
    onRenameBase({
      id: base.id,
      name: base.name
    })
  }, [base.id, base.name, closeContextMenu, onRenameBase])

  const handleRequestDelete = useCallback(() => {
    closeContextMenu()
    setIsDeleteDialogOpen(true)
  }, [closeContextMenu])

  const handleDeleteBase = useCallback(async () => {
    await onDeleteBase(base.id)
  }, [base.id, onDeleteBase])

  return (
    <>
      <div className="group/kb group relative w-full" onContextMenu={handleContextMenu}>
        <div
          className={cn(
            'grid min-h-11 w-full grid-cols-[minmax(0,1fr)_1.75rem] items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition-colors',
            selected ? 'bg-secondary' : 'hover:bg-accent'
          )}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onSelectBase(base.id)}
            className="grid min-h-0 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center justify-start gap-2.5 rounded-lg p-0 text-left shadow-none hover:bg-transparent">
            <KnowledgeBaseIcon />

            <div className="min-w-0">
              <div className="truncate font-medium text-foreground text-sm leading-5">{base.name}</div>
              <div className="flex min-w-0 items-center gap-1.5 text-foreground-muted text-xs leading-4">
                <span className="truncate">{t('knowledge.meta.documents_count', { count: base.itemCount })}</span>
                <span
                  className={cn('size-1.5 shrink-0 rounded-full', statusDotClassNames[base.status])}
                  aria-label={statusLabel}
                  title={statusLabel}
                />
              </div>
            </div>
          </Button>

          <KnowledgeBaseRowMenu
            open={isMenuOpen}
            menuPosition={contextMenuPosition}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.more')}
                className={cn(
                  'size-7 min-h-7 min-w-7 justify-self-end text-foreground-muted hover:bg-accent group-focus-within/kb:opacity-100 group-hover/kb:opacity-100',
                  isMenuOpen ? 'opacity-100' : 'opacity-0'
                )}
                onClick={handleMoreButtonClick}>
                <MoreHorizontal />
              </Button>
            }
            onOpenChange={handleMenuOpenChange}
            availableGroups={availableGroups}
            canMoveToUngrouped={base.groupId !== null}
            onRename={handleRenameBase}
            onMove={handleMoveBase}
            onRequestDelete={handleRequestDelete}
          />
        </div>
      </div>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={t('knowledge.context.delete_confirm_title')}
        description={t('knowledge.context.delete_confirm_description')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleDeleteBase}
      />
    </>
  )
}

export default KnowledgeBaseRow
