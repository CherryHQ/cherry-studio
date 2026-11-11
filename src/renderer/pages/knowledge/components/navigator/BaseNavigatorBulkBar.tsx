import { ArrowRightLeft, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ConfirmDialog,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY } from '@renderer/pages/knowledge/utils/group'
import type { Group } from '@shared/data/types/group'

interface BaseNavigatorBulkBarProps {
  selectedCount: number
  groups: Group[]
  /** True when any selected base is already ungrouped — hide the ungrouped move target. */
  canMoveToUngrouped: boolean
  onMove: (groupId: string | null) => void
  onDelete: () => void
}

const BaseNavigatorBulkBar = ({
  selectedCount,
  groups,
  canMoveToUngrouped,
  onMove,
  onDelete
}: BaseNavigatorBulkBarProps) => {
  const { t } = useTranslation()
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isMoveOpen, setIsMoveOpen] = useState(false)
  const hasMoveTargets = canMoveToUngrouped || groups.length > 0
  const moveLabel = t('knowledge.context.move_to')
  const deleteLabel = t('knowledge.navigator.bulk.delete')

  const moveTargets = useMemo(
    () => [
      ...(canMoveToUngrouped ? [{ id: null as string | null, label: t(DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY) }] : []),
      ...groups.map((group) => ({ id: group.id as string | null, label: group.name }))
    ],
    [canMoveToUngrouped, groups, t]
  )

  return (
    <>
      <div className="flex min-h-8 w-full min-w-0 items-center justify-between gap-2 px-1">
        <span className="shrink-0 whitespace-nowrap text-sm text-foreground">
          {t('knowledge.navigator.bulk.selected_count', { count: selectedCount })}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {hasMoveTargets ? (
            <Popover open={isMoveOpen} onOpenChange={setIsMoveOpen}>
              <Tooltip content={moveLabel} asChild>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" size="icon-sm" aria-label={moveLabel}>
                    <ArrowRightLeft className="size-3.5" />
                  </Button>
                </PopoverTrigger>
              </Tooltip>
              <PopoverContent align="end" className="w-44 p-1">
                <MenuList>
                  {moveTargets.map((target) => (
                    <MenuItem
                      key={target.id ?? 'ungrouped'}
                      label={target.label}
                      onClick={() => {
                        setIsMoveOpen(false)
                        onMove(target.id)
                      }}
                    />
                  ))}
                </MenuList>
              </PopoverContent>
            </Popover>
          ) : null}
          <Tooltip content={deleteLabel} asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={deleteLabel}
              onClick={() => setIsDeleteOpen(true)}>
              <Trash2 className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title={t('knowledge.navigator.bulk.delete_confirm_title')}
        description={t('knowledge.navigator.bulk.delete_confirm_description', { count: selectedCount })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={onDelete}
      />
    </>
  )
}

export default BaseNavigatorBulkBar
