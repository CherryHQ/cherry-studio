import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { MoreHorizontal } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BaseNavigatorSectionTrigger from './BaseNavigatorSectionTrigger'
import { KnowledgeGroupRowMenu } from './NavigatorMenu'
import type { KnowledgeGroupRowProps } from './types'
import useContextMenuPosition from './useContextMenuPosition'

const KnowledgeGroupRow = ({
  group,
  itemCount,
  onRenameGroup,
  onCreateBase,
  onDeleteGroup
}: KnowledgeGroupRowProps) => {
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

  const handleRenameGroup = useCallback(() => {
    closeContextMenu()
    onRenameGroup({
      id: group.id,
      name: group.name
    })
  }, [closeContextMenu, group.id, group.name, onRenameGroup])

  const handleRequestDelete = useCallback(() => {
    closeContextMenu()
    setIsDeleteDialogOpen(true)
  }, [closeContextMenu])

  const handleCreateBase = useCallback(() => {
    closeContextMenu()
    onCreateBase(group.id)
  }, [closeContextMenu, group.id, onCreateBase])

  const handleDeleteGroup = useCallback(async () => {
    await onDeleteGroup(group.id)
  }, [group.id, onDeleteGroup])

  return (
    <>
      <BaseNavigatorSectionTrigger
        label={group.name}
        itemCount={itemCount}
        actionSlot={
          <KnowledgeGroupRowMenu
            open={isMenuOpen}
            menuPosition={contextMenuPosition}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.more')}
                className={cn(
                  'size-6 min-h-6 min-w-6 rounded-md p-0 text-foreground-muted hover:bg-accent hover:text-foreground group-focus-within/grp:opacity-100 group-hover/grp:opacity-100 [&_svg]:size-3.5',
                  isMenuOpen ? 'opacity-100' : 'opacity-0'
                )}
                onClick={handleMoreButtonClick}>
                <MoreHorizontal />
              </Button>
            }
            onOpenChange={handleMenuOpenChange}
            onRename={handleRenameGroup}
            onCreateBase={handleCreateBase}
            onRequestDelete={handleRequestDelete}
          />
        }
        onContextMenu={handleContextMenu}
      />

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={t('knowledge.groups.delete_confirm_title')}
        description={t('knowledge.groups.delete_confirm_description')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleDeleteGroup}
      />
    </>
  )
}

export default KnowledgeGroupRow
