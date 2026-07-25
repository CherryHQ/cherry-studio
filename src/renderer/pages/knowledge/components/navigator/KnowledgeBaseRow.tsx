import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import KnowledgeRowActionsMenu from '@renderer/pages/knowledge/components/KnowledgeRowActionsMenu'
import { DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY } from '@renderer/pages/knowledge/utils/group'
import { ArrowRightLeft, FolderPlus, PencilLine, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { KnowledgeBaseRowProps } from './types'

const KnowledgeBaseRow = ({
  base,
  groups,
  selected,
  onSelectBase,
  onMoveBase,
  onRenameBase,
  onCreateGroup,
  onDeleteBase
}: KnowledgeBaseRowProps) => {
  const { t } = useTranslation()
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const availableGroups = useMemo(() => groups.filter((group) => group.id !== base.groupId), [base.groupId, groups])
  const canMoveToUngrouped = base.groupId !== null

  const handleMoveBase = useCallback(
    async (groupId: string | null) => {
      if (base.groupId === groupId) return
      await onMoveBase(base.id, groupId)
    },
    [base.groupId, base.id, onMoveBase]
  )

  const handleRenameBase = useCallback(() => {
    onRenameBase({ id: base.id, name: base.name })
  }, [base.id, base.name, onRenameBase])

  const handleCreateGroup = useCallback(() => {
    onCreateGroup(base.id)
  }, [base.id, onCreateGroup])

  const handleRequestDelete = useCallback(() => {
    setIsDeleteDialogOpen(true)
  }, [])

  const handleDeleteBase = useCallback(async () => {
    await onDeleteBase(base.id)
  }, [base.id, onDeleteBase])

  const contextMenuItems = useMemo<CommandContextMenuExtraItem[]>(() => {
    const items: CommandContextMenuExtraItem[] = [
      {
        type: 'item',
        id: 'rename',
        label: t('knowledge.context.rename'),
        icon: <PencilLine className="size-3.5" />,
        onSelect: handleRenameBase
      }
    ]

    if (canMoveToUngrouped || availableGroups.length > 0) {
      items.push({
        type: 'submenu',
        id: 'move',
        label: t('knowledge.context.move_to'),
        icon: <ArrowRightLeft className="size-3.5" />,
        children: [
          ...(canMoveToUngrouped
            ? ([
                {
                  type: 'item' as const,
                  id: 'move-to-ungrouped',
                  label: t(DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY),
                  onSelect: () => void handleMoveBase(null)
                }
              ] as const)
            : []),
          ...availableGroups.map((group) => ({
            type: 'item' as const,
            id: `move-to-${group.id}`,
            label: group.name,
            onSelect: () => void handleMoveBase(group.id)
          })),
          { type: 'separator' as const },
          // Creating a group from here also moves this base into it (see
          // KnowledgePageProvider.submitCreateGroup), same as the top-level entry below.
          {
            type: 'item' as const,
            id: 'create-group',
            label: t('knowledge.groups.add'),
            onSelect: handleCreateGroup
          }
        ]
      })
    } else {
      // No group exists and the base is ungrouped — no move targets to offer, so
      // surface group creation directly (the sole entry point for the first group).
      items.push({
        type: 'item',
        id: 'create-group',
        label: t('knowledge.groups.add'),
        icon: <FolderPlus className="size-3.5" />,
        onSelect: handleCreateGroup
      })
    }

    items.push({ type: 'separator' })
    items.push({
      type: 'item',
      id: 'delete',
      label: t('knowledge.context.delete'),
      icon: <Trash2 className="size-3.5" />,
      destructive: true,
      onSelect: handleRequestDelete
    })

    return items
  }, [availableGroups, canMoveToUngrouped, handleCreateGroup, handleMoveBase, handleRenameBase, handleRequestDelete, t])

  return (
    <>
      <CommandContextMenu location="webcontents.context" extraItems={contextMenuItems}>
        <div
          className={cn(
            'group/row flex w-full items-center gap-1 rounded-md px-2.5 py-1.5 transition-colors',
            selected ? 'bg-secondary' : 'hover:bg-accent'
          )}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onSelectBase(base.id)}
            className="flex min-h-0 min-w-0 flex-1 items-center justify-start rounded-md p-0 text-left shadow-none hover:bg-transparent">
            <div className="min-w-0 truncate font-medium text-foreground text-sm leading-5">{base.name}</div>
          </Button>
          <KnowledgeRowActionsMenu items={contextMenuItems} />
        </div>
      </CommandContextMenu>

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
