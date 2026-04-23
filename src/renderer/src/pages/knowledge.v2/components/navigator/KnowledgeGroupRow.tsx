import { ConfirmDialog } from '@cherrystudio/ui'
import { Briefcase } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BaseNavigatorSectionTrigger from './BaseNavigatorSectionTrigger'
import { KnowledgeGroupRowMenu, NavigatorMoreButton } from './NavigatorMenu'
import type { KnowledgeGroupRowProps } from './types'
import useContextMenuPosition from './useContextMenuPosition'

const KnowledgeGroupRow = ({ group, itemCount, onRenameGroup, onDeleteGroup }: KnowledgeGroupRowProps) => {
  const { t } = useTranslation()
  const { contextMenuPosition, closeContextMenu, handleContextMenu, handleMoreButtonClick } = useContextMenuPosition()
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

  const handleDeleteGroup = useCallback(async () => {
    await onDeleteGroup(group.id)
  }, [group.id, onDeleteGroup])

  return (
    <>
      <BaseNavigatorSectionTrigger
        label={group.name}
        itemCount={itemCount}
        leadingSlot={<Briefcase className="size-[11px] shrink-0" strokeWidth={1.5} />}
        actionSlot={
          <NavigatorMoreButton
            visible={Boolean(contextMenuPosition)}
            className="group-focus-within/grp:opacity-100 group-hover/grp:opacity-100"
            onClick={handleMoreButtonClick}
          />
        }
        onContextMenu={handleContextMenu}
      />

      <KnowledgeGroupRowMenu
        menuPosition={contextMenuPosition}
        onClose={closeContextMenu}
        onRename={handleRenameGroup}
        onRequestDelete={handleRequestDelete}
      />

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title={t('knowledge_v2.groups.delete_confirm_title')}
        description={t('knowledge_v2.groups.delete_confirm_description')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleDeleteGroup}
      />
    </>
  )
}

export default KnowledgeGroupRow
