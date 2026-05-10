import { Button } from '@cherrystudio/ui'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import DataSourceFilters from './DataSourceFilters'
import type { DataSourceFilter } from './utils/models'

interface DataSourcePanelHeaderProps {
  activeFilter: DataSourceFilter
  readyCount: number
  totalCount: number
  onFilterChange: (value: DataSourceFilter) => void
  onAdd: () => void
}

const DataSourcePanelHeader = ({
  activeFilter,
  readyCount,
  totalCount,
  onFilterChange,
  onAdd
}: DataSourcePanelHeaderProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex shrink-0 items-center justify-between px-3 py-2">
      <DataSourceFilters value={activeFilter} onValueChange={onFilterChange} />

      <div className="flex items-center gap-1.5">
        <span className="mr-0.5 text-muted-foreground/35 text-xs leading-4">
          {t('knowledge_v2.data_source.ready_summary', { ready: readyCount, total: totalCount })}
        </span>
        <Button
          type="button"
          className="h-5 min-h-5 rounded bg-primary px-2 text-primary-foreground leading-4 shadow-none hover:bg-primary/90"
          onClick={onAdd}>
          <Plus className="size-2.5" />
          {t('common.add')}
        </Button>
      </div>
    </div>
  )
}

export default DataSourcePanelHeader
