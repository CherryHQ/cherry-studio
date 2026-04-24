import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { statusDotClassNames } from '../statusStyles'
import { KnowledgeBaseRowMenu, NavigatorMoreButton } from './NavigatorMenu'
import type { KnowledgeBaseRowProps } from './types'
import { DEFAULT_DOCUMENT_COUNT } from './types'
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

  const handleMoveBase = useCallback(
    async (groupId: string) => {
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
      <div className="group relative w-full" onContextMenu={handleContextMenu}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onSelectBase(base.id)}
          className={cn(
            'h-10.25 min-h-10.25 w-full justify-start gap-2 rounded-md px-1.5 py-1.25 text-left font-normal text-foreground shadow-none transition-all duration-150',
            selected ? 'bg-accent hover:bg-accent hover:text-foreground' : 'hover:bg-accent/60 hover:text-foreground'
          )}>
          <div className="flex size-6 shrink-0 items-center justify-center rounded bg-muted/60 text-xs">
            <span aria-hidden="true">{base.emoji}</span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.6875rem] text-foreground leading-4.125">{base.name}</div>
            <div className="mt-px flex items-center gap-1">
              <span className="text-[0.5625rem] text-muted-foreground/45 leading-3.375">
                {t('knowledge_v2.meta.documents_count', { count: DEFAULT_DOCUMENT_COUNT })}
              </span>
              <span aria-hidden="true" className={cn('size-1.5 rounded-full', statusDotClassNames.completed)} />
            </div>
          </div>
        </Button>

        <NavigatorMoreButton
          visible={Boolean(contextMenuPosition)}
          className="-translate-y-1/2 absolute top-1/2 right-1.5 group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={handleMoreButtonClick}
        />
      </div>

      <KnowledgeBaseRowMenu
        menuPosition={contextMenuPosition}
        availableGroups={availableGroups}
        onClose={closeContextMenu}
        onRename={handleRenameBase}
        onMove={handleMoveBase}
        onRequestDelete={handleRequestDelete}
      />

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={t('knowledge_v2.context.delete_confirm_title')}
        description={t('knowledge_v2.context.delete_confirm_description')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleDeleteBase}
      />
    </>
  )
}

export default KnowledgeBaseRow
