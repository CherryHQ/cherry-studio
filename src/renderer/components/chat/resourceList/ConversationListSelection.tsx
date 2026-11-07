import { Archive } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'

import { type ResourceListItemBase, useResourceListView } from './base'

export function ConversationListSelectionToggle({ onSelect }: { onSelect: () => void }) {
  const { t } = useTranslation()

  return (
    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onSelect}>
      {t('common.select')}
    </Button>
  )
}

interface ConversationListSelectionToolbarProps<T extends ResourceListItemBase> {
  archiveDisabled?: boolean
  canSelectAll: boolean
  canSelectItem: (item: T) => boolean
  onArchive: () => void
  onCancel: () => void
  onSelectAll: (items: readonly T[]) => void
  selectedCount: number
}

export function ConversationListSelectionToolbar<T extends ResourceListItemBase>({
  archiveDisabled = false,
  canSelectAll,
  canSelectItem,
  onArchive,
  onCancel,
  onSelectAll,
  selectedCount
}: ConversationListSelectionToolbarProps<T>) {
  const { t } = useTranslation()
  const { items } = useResourceListView<T>()
  const selectableItems = items.filter(canSelectItem)

  return (
    <div className="flex shrink-0 items-center gap-1.5 px-2 py-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={!canSelectAll || selectableItems.length === 0}
        onClick={() => onSelectAll(selectableItems)}>
        {t('common.select_all_filtered')}
      </Button>
      <span className="text-muted-foreground text-xs" aria-live="polite">
        {t('common.selectedItems', { count: selectedCount })}
      </span>
      <div className="min-w-0 flex-1" />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        disabled={selectedCount === 0 || archiveDisabled}
        onClick={onArchive}>
        <Archive className="size-3.5" />
        {t('common.archive')}
        {selectedCount > 0 ? ` (${selectedCount})` : ''}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </div>
  )
}
