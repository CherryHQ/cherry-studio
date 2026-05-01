import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { formatRelativeTime } from '@renderer/pages/knowledge.v2/utils'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const { t, i18n } = useTranslation()
  const { contextMenuPosition, closeContextMenu, handleContextMenu, handleMoreButtonClick } = useContextMenuPosition()
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const availableGroups = useMemo(() => groups.filter((group) => group.id !== base.groupId), [base.groupId, groups])
  const formattedUpdatedAt = useMemo(
    () => formatRelativeTime(base.updatedAt, i18n.language),
    [base.updatedAt, i18n.language]
  )
  const statusLabel = t(`knowledge_v2.status.${base.status}`)

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
      <div className="group/kb group relative w-full" onContextMenu={handleContextMenu}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onSelectBase(base.id)}
          className={cn(
            'h-auto min-h-8 w-full cursor-pointer items-center justify-start gap-2 rounded-lg px-1.5 py-1.25 text-left font-normal text-foreground shadow-none transition-all duration-150',
            selected ? 'bg-accent hover:bg-accent hover:text-foreground' : 'hover:bg-accent/60 hover:text-foreground'
          )}>
          <div
            className="flex size-6 shrink-0 items-center justify-center rounded text-xs"
            style={{ background: 'rgba(139, 92, 246, 0.125)' }}>
            <span aria-hidden="true">{base.emoji}</span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="contents">
              <div className="truncate text-[11px]">{base.name}</div>
              <div className="mt-px flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground/45">{formattedUpdatedAt}</span>
                <span
                  className={cn('size-1 shrink-0 rounded-full', statusDotClassNames[base.status])}
                  aria-label={statusLabel}
                  title={statusLabel}
                />
              </div>
            </div>
          </div>
        </Button>

        <NavigatorMoreButton
          visible={Boolean(contextMenuPosition)}
          className="-translate-y-1/2 absolute top-1/2 right-1.5 text-muted-foreground/25 hover:bg-foreground/5 group-focus-within/kb:opacity-100 group-focus-within:opacity-100 group-hover/kb:opacity-100 group-hover:opacity-100"
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
