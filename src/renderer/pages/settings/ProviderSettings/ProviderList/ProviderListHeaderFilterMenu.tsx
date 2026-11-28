import { Filter } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@cherrystudio/ui'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils/style'

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
  const hasActiveFilter = filterMode !== 'all'

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('settings.provider.filter.label')}
          disabled={disabled}
          className={cn('group', triggerClassName)}>
          <Filter
            size={triggerIconSize}
            className={cn(
              'shrink-0',
              hasActiveFilter ? 'text-primary!' : 'text-muted-foreground group-hover:text-foreground'
            )}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-fit min-w-32 rounded-xl p-1.5">
        <DropdownMenuRadioGroup value={filterMode}>
          {FILTER_MENU_OPTIONS.map(({ mode, labelKey }) => (
            <DropdownMenuRadioItem key={mode} value={mode} onSelect={() => onFilterChange(mode)}>
              {t(labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
