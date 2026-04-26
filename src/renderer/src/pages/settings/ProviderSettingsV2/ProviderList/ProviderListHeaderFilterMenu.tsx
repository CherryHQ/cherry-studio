import { MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Check, Filter } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ProviderFilterMode } from './providerFilterMode'

const FILTER_MENU_ITEM_CLASS = 'rounded-3xs px-2 py-[5px] text-[13px] hover:bg-accent/40'

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
        <button
          type="button"
          disabled={disabled}
          className="flex size-5 items-center justify-center text-foreground/55 transition-colors hover:text-foreground/80">
          <Filter size={11} className={cn(filterMode === 'agent' && 'text-(--color-primary)')} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-1">
        <MenuList>
          {FILTER_MENU_OPTIONS.map(({ mode, labelKey }) => (
            <MenuItem
              key={mode}
              label={t(labelKey)}
              className={FILTER_MENU_ITEM_CLASS}
              icon={<Check className={cn('size-4', filterMode === mode ? 'opacity-100' : 'opacity-0')} />}
              onClick={() => onFilterChange(mode)}
            />
          ))}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}
