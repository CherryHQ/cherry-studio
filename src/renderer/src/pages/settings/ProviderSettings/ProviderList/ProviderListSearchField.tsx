import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { Search } from 'lucide-react'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface ProviderListSearchFieldProps {
  value: string
  disabled: boolean
  onValueChange: (value: string) => void
  /** Optional trailing slot rendered to the right of the input (e.g. filter trigger). */
  trailing?: ReactNode
}

export default function ProviderListSearchField({
  value,
  disabled,
  onValueChange,
  trailing
}: ProviderListSearchFieldProps) {
  const { t } = useTranslation()

  return (
    <div className={providerListClasses.searchRow}>
      <div className={`${providerListClasses.searchWrap} min-w-0 flex-1`}>
        <Search size={9} className={providerListClasses.searchIcon} />
        <input
          value={value}
          placeholder={t('settings.provider.search')}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              onValueChange('')
            }
          }}
          disabled={disabled}
          className={providerListClasses.searchInput}
        />
      </div>
      {trailing}
    </div>
  )
}
