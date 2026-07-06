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
  onRestore: (item: TrashItem) => void
  onDelete: (item: TrashItem) => void
}

const TrashItemRow: FC<TrashItemRowProps> = ({ item, retentionDays, isRestoring, onRestore, onDelete }) => {
  const { t } = useTranslation()

  const deletedTime = formatDeletedTime(item.deletedAt)
  const deletedAtLabel = t('settings.data.trash.deleted_at', { time: deletedTime })
  const daysRemaining = computeDaysRemaining(item.deletedAt, retentionDays)

  return (
    <div className="flex min-h-9 items-center gap-2 border-border-muted border-b last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-foreground text-sm">
        {item.name || t('settings.data.trash.unnamed')}
      </span>
      <span className="shrink-0 text-foreground-muted text-xs" title={deletedAtLabel} aria-label={deletedAtLabel}>
        {deletedTime}
      </span>
      {daysRemaining !== null && (
        <span className="shrink-0 text-foreground-muted text-xs">
          {'· '}
          {daysRemaining < 1
            ? t('settings.data.trash.days_remaining_lt_one')
            : t('settings.data.trash.days_remaining', { count: daysRemaining })}
        </span>
      )}
      <Tooltip title={t('settings.data.trash.restore.label')}>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-foreground-muted hover:text-foreground"
          aria-label={t('settings.data.trash.restore.label')}
          loading={isRestoring}
          onClick={() => onRestore(item)}>
          {!isRestoring && <ArchiveRestore size={16} />}
        </Button>
      </Tooltip>
      <Tooltip title={t('settings.data.trash.permanent_delete.label')}>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-foreground-muted hover:text-destructive"
          aria-label={t('settings.data.trash.permanent_delete.label')}
          onClick={() => onDelete(item)}>
          <Trash2 size={16} />
        </Button>
      </Tooltip>
    </div>
  )
}

export default TrashItemRow
