import { SearchInput } from '@cherrystudio/ui'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
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
      <SearchInput
        containerClassName={`${providerListClasses.searchWrap} min-w-0 flex-1`}
        className={providerListClasses.searchInput}
        value={value}
        placeholder={t('settings.provider.search')}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onValueChange('')
          }
        }}
        trailing={trailing}
      />
    </div>
  )
}
