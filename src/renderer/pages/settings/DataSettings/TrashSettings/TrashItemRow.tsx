import { Button, Tooltip } from '@cherrystudio/ui'
import { ArchiveRestore, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { TrashItem } from './trashUtils'
import { computeDaysRemaining, formatDeletedTime } from './trashUtils'

interface TrashItemRowProps {
  item: TrashItem
  retentionDays: number
  isRestoring: boolean
  /** Any row in this section has a mutation in flight — they share one instance. */
  isSectionBusy?: boolean
  onRestore: (item: TrashItem) => void
  onDelete: (item: TrashItem) => void
}

const TrashItemRow: FC<TrashItemRowProps> = ({
  item,
  retentionDays,
  isRestoring,
  isSectionBusy = false,
  onRestore,
  onDelete
}) => {
  const { t } = useTranslation()

  const deletedTime = formatDeletedTime(item.deletedAt)
  const deletedAtLabel = t('settings.data.trash.deleted_at', { time: deletedTime })
  const daysRemaining = computeDaysRemaining(item.deletedAt, retentionDays)

  return (
    <div className="flex min-h-9 items-center gap-2 border-border border-b last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-foreground text-sm">
        {item.name || t('settings.data.trash.unnamed')}
      </span>
      <span className="shrink-0 text-muted-foreground text-xs" title={deletedAtLabel} aria-label={deletedAtLabel}>
        {deletedTime}
      </span>
      {daysRemaining !== null && (
        <span className="shrink-0 text-muted-foreground text-xs">
          {'· '}
          {daysRemaining === 0
            ? t('settings.data.trash.days_remaining_expired')
            : daysRemaining === 'less-than-day'
              ? t('settings.data.trash.days_remaining_lt_one')
              : t('settings.data.trash.days_remaining', { count: daysRemaining })}
        </span>
      )}
      <Tooltip title={t('settings.data.trash.restore.label')}>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('settings.data.trash.restore.label')}
          loading={isRestoring}
          disabled={isSectionBusy && !isRestoring}
          onClick={() => onRestore(item)}>
          {!isRestoring && <ArchiveRestore size={16} />}
        </Button>
      </Tooltip>
      <Tooltip title={t('settings.data.trash.permanent_delete.label')}>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          aria-label={t('settings.data.trash.permanent_delete.label')}
          disabled={isRestoring || isSectionBusy}
          onClick={() => onDelete(item)}>
          <Trash2 size={16} />
        </Button>
      </Tooltip>
    </div>
  )
}

export default TrashItemRow
