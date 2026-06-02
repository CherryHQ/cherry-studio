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
    <div role="radiogroup" className="flex w-max shrink-0 items-center gap-2">
      {dataSourceFilterDefinitions.map(({ labelKey, value: filterValue, icon: Icon }) => {
        const selected = value === filterValue

        return (
          <button
            key={filterValue}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onValueChange(filterValue)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium text-sm leading-5 transition-colors',
              'text-foreground-secondary hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              selected && 'bg-accent font-semibold text-foreground'
            )}>
            <Icon className="size-3.5 shrink-0" strokeWidth={selected ? 2.5 : 2} />
            {t(labelKey)}
          </button>
        )
      })}
    </div>
  )
}

export default DataSourceFilters
