import { Button } from '@cherrystudio/ui'
import { RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface DataSourcePanelHeaderProps {
  /** Server-side total across all pages. */
  total: number
  /** Rows currently loaded in the renderer (≤ total when pages remain). */
  loadedCount: number
  selectedCount: number
  onBulkReindex: () => void
  onBulkDelete: () => void
}

const DataSourcePanelHeader = ({
  total,
  loadedCount,
  selectedCount,
  onBulkReindex,
  onBulkDelete
}: DataSourcePanelHeaderProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-8 min-w-0 items-center justify-between gap-3">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-foreground text-sm">
          {t('knowledge.data_source.bulk.selected_count', { count: selectedCount })}
        </span>
        {/* Selection only covers loaded rows; warn when unloaded pages remain so the
            checked-all state doesn't read as "all rows in the base". */}
        {total > loadedCount ? (
          <span className="shrink-0 text-foreground-muted text-xs">
            {t('knowledge.data_source.bulk.loaded_only_hint', { total })}
          </span>
        ) : null}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onBulkReindex}>
          <RefreshCw className="size-3.5" />
          {t('knowledge.data_source.bulk.reindex')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onBulkDelete}>
          <Trash2 className="size-3.5" />
          {t('knowledge.data_source.bulk.delete')}
        </Button>
      </div>
    </div>
  )
}

export default DataSourcePanelHeader
