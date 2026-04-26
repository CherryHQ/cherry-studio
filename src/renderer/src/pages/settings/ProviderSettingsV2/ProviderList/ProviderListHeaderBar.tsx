import type { ProviderFilterMode } from './providerFilterMode'
import ProviderListHeaderFilterMenu from './ProviderListHeaderFilterMenu'
import ProviderListHeaderTitle from './ProviderListHeaderTitle'

export type { ProviderFilterMode } from './providerFilterMode'

interface ProviderListHeaderBarProps {
  filteredCount: number
  filterMode: ProviderFilterMode
  disabled: boolean
  onFilterChange: (mode: ProviderFilterMode) => void
}

export default function ProviderListHeaderBar({
  filteredCount,
  filterMode,
  disabled,
  onFilterChange
}: ProviderListHeaderBarProps) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-2 px-3 pt-3.5 pb-1.5">
      <ProviderListHeaderTitle filteredCount={filteredCount} />
      <ProviderListHeaderFilterMenu filterMode={filterMode} disabled={disabled} onFilterChange={onFilterChange} />
    </div>
  )
}
