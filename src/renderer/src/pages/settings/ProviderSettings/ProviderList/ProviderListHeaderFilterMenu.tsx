import { MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/shared/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils'
import { Check, Filter } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ProviderFilterMode } from './providerFilterMode'

const FILTER_MENU_OPTIONS: { mode: ProviderFilterMode; labelKey: string }[] = [
  { mode: 'all', labelKey: 'settings.provider.filter.all' },
  { mode: 'agent', labelKey: 'settings.provider.filter.agent' }
]

interface ProviderListHeaderFilterMenuProps {
  filterMode: ProviderFilterMode
  disabled: boolean
  onFilterChange: (mode: ProviderFilterMode) => void
}

export default function ProviderListHeaderFilterMenu({
  filterMode,
  disabled,
  onFilterChange
}: ProviderListHeaderFilterMenuProps) {
  const { t } = useTranslation()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} className={providerListClasses.filterTrigger}>
          <Filter size={9} className={cn(filterMode === 'agent' && 'text-(--color-primary)')} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={cn(providerListClasses.itemMenuContent, 'w-40')}>
        <MenuList>
          {FILTER_MENU_OPTIONS.map(({ mode, labelKey }) => (
            <MenuItem
              key={mode}
              label={t(labelKey)}
              className={providerListClasses.itemMenuEntry}
              icon={<Check className={cn('size-4', filterMode === mode ? 'opacity-100' : 'opacity-0')} />}
              onClick={() => onFilterChange(mode)}
            />
          ))}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}
