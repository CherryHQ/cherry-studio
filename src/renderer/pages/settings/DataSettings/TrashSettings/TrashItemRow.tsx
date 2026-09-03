import { Button, Checkbox, Tooltip } from '@cherrystudio/ui'
import { RotateCcw, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { TrashItem } from './trashUtils'
import { computeDaysRemaining, formatDeletedTime } from './trashUtils'

interface TrashItemRowProps {
  item: TrashItem
  retentionDays: number
  isRestoring: boolean
  showSelection: boolean
  selected: boolean
  onSelectedChange: (selected: boolean) => void
  /** Any row in this section has a mutation in flight — they share one instance. */
  isSectionBusy?: boolean
  onRestore: (item: TrashItem) => void
  onDelete: (item: TrashItem) => void
}

const TrashItemRow: FC<TrashItemRowProps> = ({
  item,
  retentionDays,
  isRestoring,
  showSelection,
  selected,
  onSelectedChange,
  isSectionBusy = false,
  onRestore,
  onDelete
}) => {
  const { t } = useTranslation()

  const deletedTime = formatDeletedTime(item.deletedAt)
  const displayName = item.name || t('settings.data.trash.unnamed')
  const deletedAtLabel = t('settings.data.trash.deleted_at', { time: deletedTime })
  const daysRemaining = computeDaysRemaining(item.deletedAt, retentionDays)
  const isBatchBlocked = isSectionBusy && !isRestoring

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 border-border border-b py-1 last:border-b-0">
      {showSelection && (
        <Checkbox
          checked={selected}
          disabled={isSectionBusy}
          aria-label={t('settings.data.trash.selection.item', { name: displayName })}
          onCheckedChange={(checked) => onSelectedChange(checked === true)}
        />
      )}
      <span className="min-w-24 flex-1 truncate text-foreground text-sm">{displayName}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
        <span title={deletedAtLabel} aria-label={deletedAtLabel}>
          {deletedTime}
        </span>
        {daysRemaining !== null && (
          <span>
            {'· '}
            {daysRemaining === 0
              ? t('settings.data.trash.days_remaining_expired')
              : daysRemaining === 'less-than-day'
                ? t('settings.data.trash.days_remaining_lt_one')
                : t('settings.data.trash.days_remaining', { count: daysRemaining })}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        <Tooltip title={t('settings.data.trash.restore.label')}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            aria-label={t('settings.data.trash.restore.label')}
            aria-disabled={isBatchBlocked || undefined}
            loading={isRestoring}
            onClick={() => {
              if (!isBatchBlocked) onRestore(item)
            }}>
            {!isRestoring && <RotateCcw size={16} />}
          </Button>
        </Tooltip>
        <Tooltip title={t('settings.data.trash.permanent_delete.label')}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            aria-label={t('settings.data.trash.permanent_delete.label')}
            aria-disabled={isBatchBlocked || undefined}
            disabled={isRestoring}
            onClick={() => {
              if (!isRestoring && !isSectionBusy) onDelete(item)
            }}>
            <Trash2 size={16} />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}

export default TrashItemRow
