import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/features/command'
import { MoreHorizontal, PencilLine, Plus, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BaseNavigatorSectionTrigger from './BaseNavigatorSectionTrigger'
import type { KnowledgeGroupRowProps } from './types'

const KnowledgeGroupRow = ({
  group,
  itemCount,
  onRenameGroup,
  onCreateBase,
  onDeleteGroup
}: KnowledgeGroupRowProps) => {
  const { t } = useTranslation()
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)

  const handleRenameGroup = useCallback(() => {
    onRenameGroup({ id: group.id, name: group.name })
  }, [group.id, group.name, onRenameGroup])

  const handleRequestDelete = useCallback(() => {
    setIsDeleteDialogOpen(true)
  }, [])

  const handleCreateBase = useCallback(() => {
    onCreateBase(group.id)
  }, [group.id, onCreateBase])

  const handleDeleteGroup = useCallback(async () => {
    await onDeleteGroup(group.id)
  }, [group.id, onDeleteGroup])

  const contextMenuItems = useMemo<CommandContextMenuExtraItem[]>(
    () => [
      {
        type: 'item',
        id: 'rename',
        label: t('knowledge.context.rename'),
        icon: <PencilLine className="size-3.5" />,
        onSelect: handleRenameGroup
      },
      {
        type: 'item',
        id: 'create-base',
        label: t('knowledge.groups.create_base_here'),
        icon: <Plus className="size-3.5" />,
        onSelect: handleCreateBase
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'delete',
        label: t('knowledge.groups.delete'),
        icon: <Trash2 className="size-3.5" />,
        destructive: true,
        onSelect: handleRequestDelete
      }
    ],
    [handleCreateBase, handleRenameGroup, handleRequestDelete, t]
  )

  return (
    <>
      <CommandContextMenu location="webcontents.context" extraItems={contextMenuItems}>
        <div className="w-full">
          <BaseNavigatorSectionTrigger
            label={group.name}
            itemCount={itemCount}
            actionSlot={
              <DropdownMenu open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('common.more')}
                    className={cn(
                      'size-6 min-h-6 min-w-6 rounded-md p-0 text-foreground-muted hover:bg-accent hover:text-foreground group-focus-within/grp:opacity-100 group-hover/grp:opacity-100 [&_svg]:size-3.5',
                      moreMenuOpen ? 'opacity-100' : 'opacity-0'
                    )}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="bottom" sideOffset={8} className="w-45">
                  <DropdownMenuItem onSelect={handleRenameGroup}>
                    <PencilLine className="size-3.5" />
                    <span>{t('knowledge.context.rename')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleCreateBase}>
                    <Plus className="size-3.5" />
                    <span>{t('knowledge.groups.create_base_here')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={handleRequestDelete}>
                    <Trash2 className="size-3.5" />
                    <span>{t('knowledge.groups.delete')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        </div>
      </CommandContextMenu>

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
