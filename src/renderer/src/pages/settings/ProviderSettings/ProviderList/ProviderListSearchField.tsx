import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/shared/primitives/ProviderSettingsPrimitives'
import { Search } from 'lucide-react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface ProviderListSearchFieldProps {
  value: string
  disabled: boolean
  onValueChange: (value: string) => void
}

export default function ProviderListSearchField({ value, disabled, onValueChange }: ProviderListSearchFieldProps) {
  const { t } = useTranslation()

  return (
    <div className="px-3 pb-1.5">
      <div className={providerListClasses.searchWrap}>
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
    </div>
  )
}
