import { providerListClasses } from '@renderer/pages/settings/ProviderSettingsV2/components/ProviderSettingsPrimitives'

import type { ProviderFilterMode } from './providerFilterMode'
import ProviderListHeaderFilterMenu from './ProviderListHeaderFilterMenu'
import ProviderListHeaderTitle from './ProviderListHeaderTitle'

export type { ProviderFilterMode } from './providerFilterMode'

interface ProviderListHeaderBarProps {
  filterMode: ProviderFilterMode
  disabled: boolean
  onFilterChange: (mode: ProviderFilterMode) => void
}

export default function ProviderListHeaderBar({ filterMode, disabled, onFilterChange }: ProviderListHeaderBarProps) {
  return (
    <div className={providerListClasses.header}>
      <ProviderListHeaderTitle />
      <ProviderListHeaderFilterMenu filterMode={filterMode} disabled={disabled} onFilterChange={onFilterChange} />
    </div>
  )
}
