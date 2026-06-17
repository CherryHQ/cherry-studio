import { MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils'
import { Check, Filter } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProviderFilterMode } from './providerFilterMode'

const FILTER_MENU_OPTIONS: { mode: ProviderFilterMode; labelKey: string }[] = [
  { mode: 'all', labelKey: 'settings.provider.filter.all' },
  { mode: 'agent', labelKey: 'settings.provider.filter.agent' },
  { mode: 'enabled', labelKey: 'settings.provider.filter.enabled' },
  { mode: 'disabled', labelKey: 'settings.provider.filter.disabled' }
]

interface ProviderListHeaderFilterMenuProps {
  filterMode: ProviderFilterMode
  disabled: boolean
  triggerClassName?: string
  triggerIconSize?: number
  onFilterChange: (mode: ProviderFilterMode) => void
}

export default function ProviderListHeaderFilterMenu({
  filterMode,
  disabled,
  triggerClassName = providerListClasses.headerIconButton,
  triggerIconSize = 14,
  onFilterChange
}: ProviderListHeaderFilterMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const hasActiveFilter = filterMode !== 'all'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('settings.provider.filter.label')}
          disabled={disabled}
          className={cn('group', triggerClassName)}>
          <Filter
            size={triggerIconSize}
            className={cn(
              'shrink-0',
              hasActiveFilter ? 'text-primary!' : 'text-muted-foreground/60 group-hover:text-muted-foreground/80'
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-fit min-w-32 rounded-xl p-1.5">
        <MenuList className="gap-1">
          {FILTER_MENU_OPTIONS.map(({ mode, labelKey }) => (
            <MenuItem
              key={mode}
              label={t(labelKey)}
              className="h-8 rounded-lg px-2.5 text-sm"
              icon={<Check className={cn('size-3.5', filterMode === mode ? 'opacity-100' : 'opacity-0')} />}
              onClick={() => {
                onFilterChange(mode)
                setOpen(false)
              }}
            />
          ))}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}
