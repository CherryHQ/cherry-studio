import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import KnowledgeBaseIcon from '../KnowledgeBaseIcon'
import { statusDotClassNames } from '../statusStyles'
import { KnowledgeBaseRowMenu, NavigatorMoreButton } from './NavigatorMenu'
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
  const { contextMenuPosition, closeContextMenu, handleContextMenu, handleMoreButtonClick } = useContextMenuPosition()
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
        {/* TODO(knowledge): Button is used as a row container here; consider switching to the Item primitive so the size/gap/radius overrides go away. */}
        <Button
          type="button"
          variant="ghost"
          onClick={() => onSelectBase(base.id)}
          className={cn(
            'min-h-11 w-full justify-start gap-2.5 rounded-xl px-2.5 py-1.5 text-left shadow-none',
            selected ? 'bg-secondary hover:bg-secondary' : 'hover:bg-accent'
          )}>
          <KnowledgeBaseIcon />

          <div className="min-w-0 flex-1 pr-5">
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

        <NavigatorMoreButton
          visible={Boolean(contextMenuPosition)}
          className="-translate-y-1/2 absolute top-1/2 right-2 text-foreground-muted hover:bg-accent group-focus-within/kb:opacity-100 group-focus-within:opacity-100 group-hover/kb:opacity-100 group-hover:opacity-100"
          onClick={handleMoreButtonClick}
        />
      </div>

      <KnowledgeBaseRowMenu
        menuPosition={contextMenuPosition}
        availableGroups={availableGroups}
        canMoveToUngrouped={base.groupId !== null}
        onClose={closeContextMenu}
        onRename={handleRenameBase}
        onMove={handleMoveBase}
        onRequestDelete={handleRequestDelete}
      />

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
