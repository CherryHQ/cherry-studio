import { type LucideIcon, RotateCcw, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Tooltip
} from '@cherrystudio/ui'

import type { ArchiveItem } from './archive'
import { computeDaysRemaining, formatDeletedTime } from './archive'

interface ArchiveItemRowProps {
  icon?: LucideIcon
  item: ArchiveItem
  retentionDays: number
  isRestoring: boolean
  showSelection: boolean
  selected: boolean
  onSelectedChange: (selected: boolean) => void
  /** Any row in this section has a mutation in flight — they share one instance. */
  isSectionBusy?: boolean
  onRestore: (item: ArchiveItem) => void
  onDelete: (item: ArchiveItem) => void
}

const ArchiveItemRow: FC<ArchiveItemRowProps> = ({
  icon: Icon,
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
    <Item
      size="sm"
      className="flex-nowrap gap-3 rounded-none border-0 border-border-subtle border-b px-0 py-2 last:border-b-0 data-[selectable=true]:cursor-pointer"
      data-selectable={showSelection && !isSectionBusy}
      onClick={(event) => {
        if (showSelection && !isSectionBusy && !(event.target as Element).closest('button')) {
          onSelectedChange(!selected)
        }
      }}>
      {showSelection && (
        <Checkbox
          checked={selected}
          disabled={isSectionBusy}
          aria-label={t('settings.data.trash.selection.item', { name: displayName })}
          onCheckedChange={(checked) => onSelectedChange(checked === true)}
        />
      )}
      {(item.icon || Icon) && (
        <ItemMedia
          variant={item.icon ? 'default' : 'icon'}
          className="size-9 rounded-lg border-0 text-muted-foreground"
          aria-hidden="true">
          {item.icon || (Icon && <Icon className="size-4.5" />)}
        </ItemMedia>
      )}
      <ItemContent className="min-w-0">
        <ItemTitle className="block w-full truncate font-normal text-foreground" title={displayName}>
          {displayName}
        </ItemTitle>
        <ItemDescription className="line-clamp-none flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs">
          {item.categoryLabel && <span>{item.categoryLabel} · </span>}
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
        </ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0 gap-1">
        <Tooltip title={t('settings.data.trash.restore.label')}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-40 dark:text-muted-foreground"
            aria-label={t('settings.data.trash.restore.label')}
            aria-disabled={isBatchBlocked || undefined}
            loading={isRestoring}
            onClick={() => {
              if (!isBatchBlocked) onRestore(item)
            }}>
            {!isRestoring && <RotateCcw size={16} className="text-muted-foreground" />}
          </Button>
        </Tooltip>
        <Tooltip title={t('settings.data.trash.permanent_delete.label')}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive focus-visible:text-destructive dark:text-muted-foreground dark:hover:text-destructive dark:focus-visible:text-destructive aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            aria-label={t('settings.data.trash.permanent_delete.label')}
            aria-disabled={isBatchBlocked || undefined}
            disabled={isRestoring}
            onClick={() => {
              if (!isRestoring && !isSectionBusy) onDelete(item)
            }}>
            <Trash2 size={16} />
          </Button>
        </Tooltip>
      </ItemActions>
    </Item>
  )
}

export default ArchiveItemRow
