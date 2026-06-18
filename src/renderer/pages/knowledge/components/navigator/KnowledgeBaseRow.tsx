import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { CommandContextMenu, type CommandContextMenuExtraItem, CommandPopupMenu } from '@renderer/components/command'
import { DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY } from '@renderer/pages/knowledge/utils'
import { ArrowRightLeft, MoreHorizontal, PencilLine, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import KnowledgeBaseIcon from '../KnowledgeBaseIcon'
import { statusDotClassNames } from '../statusStyles'
import type { KnowledgeBaseRowProps } from './types'

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
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const availableGroups = useMemo(() => groups.filter((group) => group.id !== base.groupId), [base.groupId, groups])
  const canMoveToUngrouped = base.groupId !== null
  const statusLabelKey = `knowledge.status.${base.status}` as const
  const statusLabel = t(statusLabelKey)

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
          }))
        ]
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
  }, [availableGroups, canMoveToUngrouped, handleMoveBase, handleRenameBase, handleRequestDelete, t])

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
            className="grid min-h-0 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center justify-start gap-2.5 rounded-lg p-0 text-start shadow-none hover:bg-transparent">
            <KnowledgeBaseIcon />

              <div className="min-w-0">
                <div className="truncate font-medium text-foreground text-sm leading-5">{base.name}</div>
                <div className="flex min-w-0 items-center gap-1.5 text-foreground-muted text-xs leading-4">
                  <span className="truncate">{t('knowledge.meta.documents_count', { count: base.itemCount })}</span>
                  <span
                    className={cn('size-1.5 shrink-0 rounded-full', statusDotClassNames[base.status])}
                    aria-label={statusLabel}
                  />
                </div>
              </div>
            </Button>

            <CommandPopupMenu
              location="webcontents.context"
              extraItems={contextMenuItems}
              align="end"
              side="bottom"
              sideOffset={6}
              contentClassName="w-45"
              open={moreMenuOpen}
              onOpenChange={setMoreMenuOpen}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.more')}
                className={cn(
                  'text-foreground-muted hover:bg-accent group-focus-within/kb:opacity-100 group-focus-within:opacity-100 group-hover/kb:opacity-100 group-hover:opacity-100',
                  moreMenuOpen ? 'opacity-100' : 'opacity-0'
                )}>
                <MoreHorizontal />
              </Button>
            </CommandPopupMenu>
          </div>
        </div>
      </CommandContextMenu>

      <ConfirmDialog
  open = { isDeleteDialogOpen }
  onOpenChange = { setIsDeleteDialogOpen }
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
