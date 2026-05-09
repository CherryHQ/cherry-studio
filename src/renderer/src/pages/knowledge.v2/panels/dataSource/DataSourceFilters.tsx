import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useTranslation } from 'react-i18next'

import { type DataSourceFilter, dataSourceFilterDefinitions } from './utils/models'

interface DataSourceFiltersProps {
  value: DataSourceFilter
  onValueChange: (value: DataSourceFilter) => void
}

const DataSourceFilters = ({ value, onValueChange }: DataSourceFiltersProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-2">
      {dataSourceFilterDefinitions.map(({ labelKey, value: filterValue }) => (
        <Button
          key={filterValue}
          type="button"
          variant="ghost"
          className={cn(
            'h-auto min-h-0 rounded px-1.5 py-px font-normal text-sm leading-4 shadow-none transition-colors',
            value === filterValue
              ? 'bg-accent text-foreground hover:bg-accent hover:text-foreground'
              : 'text-muted-foreground/50 hover:text-foreground'
          )}
          onClick={() => onValueChange(filterValue)}>
          {t(labelKey)}
        </Button>
      ))}
    </div>
  )
}

export default DataSourceFilters
